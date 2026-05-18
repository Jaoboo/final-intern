from datetime import datetime, time

from sqlalchemy import func, select

from .database import DefectMode, Employee, Report, SessionLocal, Model, Volume, Defect, parse_model_qr
from ..schemas import VolumeFormInsert, DefectFormInsert, ReportFormInsert


# ─── Shift Helpers ────────────────────────────────────────────────── #
def get_shift_group(scan_time: datetime) -> str:
    day_start = time(7, 30)
    day_end   = time(19, 50)
    if day_start <= scan_time.time() <= day_end:
        return "Day"
    return "Night"

def get_norm_shift(scan_time: datetime, shift: str) -> str:
    return f"{shift}/{get_shift_group(scan_time)}"

# ─── Master Data ──────────────────────────────────────────────────── #
def get_all_models():
    db = SessionLocal()
    try:
        return db.query(Model).all()
    finally:
        db.close()

def get_all_employees():
    db = SessionLocal()
    try:
        return db.query(Employee).all()
    finally:
        db.close()

def get_all_defect_modes():
    db = SessionLocal()
    try:
        return db.query(DefectMode).all()
    finally:
        db.close()

# ─── Insert ───────────────────────────────────────────────────────── #
def insert_volume(data: VolumeFormInsert):
    db = SessionLocal()
    try:
        scan_time = datetime.now()
        new_volume = Volume(
            model_name = data.v_model,
            quantity   = data.v_quantity,
            line       = data.v_line,
            scan_time  = scan_time.time().replace(microsecond=0),
            scan_date  = scan_time.date(),
            shift      = data.v_shift,
            group      = get_shift_group(scan_time),
        )
        db.add(new_volume)
        db.commit()
        db.refresh(new_volume)
        return new_volume
    finally:
        db.close()

def insert_defect(data: DefectFormInsert):
    db = SessionLocal()
    try:
        scan_time = datetime.now()
        inserted  = []
        skipped   = []

        for qr in data.d_qr_model:
            existing = (
                db.query(Defect)
                .filter(Defect.model_qr == qr, Defect.defect_qr == data.d_qr_defect)
                .order_by(Defect.scan_date.asc(), Defect.scan_time.asc())
                .first()
            )
            if existing:
                # ── FIX: outerjoin อาจทำให้ employee เป็น None ──
                emp_name = ""
                if existing.employee:
                    emp_name = existing.employee.name or existing.employee.full_name or ""
                skipped.append({
                    "qr":        qr,
                    "scan_date": str(existing.scan_date),
                    "scan_time": str(existing.scan_time),
                    "shift":     existing.shift,
                    "name":      emp_name,
                })
                continue

            parsed = parse_model_qr(qr)
            new_defect = Defect(
                name      = data.d_name,
                part_no   = parsed["part_no"],
                line      = parsed["line"],
                model_qr  = qr,
                defect_qr = data.d_qr_defect,
                scan_time = scan_time.time().replace(microsecond=0),
                scan_date = scan_time.date(),
                shift     = data.d_shift,
                group     = get_shift_group(scan_time),
            )
            db.add(new_defect)
            try:
                db.flush()
                inserted.append(qr)
            except Exception:
                db.rollback()
                existing2 = (
                    db.query(Defect)
                    .filter(Defect.model_qr == qr, Defect.defect_qr == data.d_qr_defect)
                    .first()
                )
                emp_name2 = ""
                if existing2 and existing2.employee:
                    emp_name2 = existing2.employee.name or existing2.employee.full_name or ""
                skipped.append({
                    "qr":        qr,
                    "scan_date": str(existing2.scan_date) if existing2 else "",
                    "scan_time": str(existing2.scan_time) if existing2 else "",
                    "shift":     existing2.shift          if existing2 else "",
                    "name":      emp_name2,
                })

        db.commit()
        return {"inserted": len(inserted), "skipped": len(skipped), "skipped_qrs": skipped}
    finally:
        db.close()

def insert_report(data: ReportFormInsert):
    db = SessionLocal()
    try:
        new_report = Report(
            mode               = data.r_mode,
            assumption_detail  = data.r_assump_detail,
            assumption_img_url = data.r_assump_img,
            action_detail      = data.r_action_detail,
            action_img_url     = data.r_action_img,
            date_day           = data.r_date,
            pic                = data.r_pic,
            progress           = data.r_progress,
            status             = data.r_status,
        )
        db.add(new_report)
        db.commit()
        db.refresh(new_report)
        return new_report
    finally:
        db.close()

# ─── Record ───────────────────────────────────────────────────────── #
def record_volume():
    db = SessionLocal()
    try:
        # ── FIX: outerjoin แทน join เพื่อไม่ให้ตัดแถวที่ model หายออก ──
        records = (
            db.query(Volume)
            .outerjoin(Volume.model)
            .order_by(Volume.scan_date.desc(), Volume.scan_time.desc())
            .all()
        )
        result  = []
        for i, r in enumerate(records, start=1):
            m = r.model  # อาจเป็น None ถ้า FK เสีย
            result.append({
                "no":              i,
                "part_no":         m.part_no         if m else "",
                "model_name":      m.model_name      if m else (r.model_name or ""),
                "prod_date":       r.prod_date        or "",
                "quantity":        r.quantity         or 0,
                "line":            r.line             or "",
                "scan_date":       r.scan_date,
                "scan_time":       r.scan_time,
                "shift":           r.shift            or "",
                "group":           r.group            or "",
                "shift_group":     f"{r.shift}/{r.group}" if r.shift and r.group else (r.shift or ""),
                "ph_top":          m.ph_top           if m else "",
                "die_list_ph_top": m.die_list_ph_top  if m else "",
                "ph_btm":          m.ph_btm           if m else "",
                "die_list_ph_btm": m.die_list_ph_btm  if m else "",
                "th_top":          m.th_top           if m else "",
                "th_btm":          m.th_btm           if m else "",
            })
        return result
    finally:
        db.close()

def record_defect():
    db = SessionLocal()
    try:
        # ── FIX: เปลี่ยนเป็น outerjoin ทุก relation
        #        เพื่อให้ดึงข้อมูลได้แม้ FK บางตัวหายหรือ name เป็น NULL ──
        records = (
            db.query(Defect)
            .outerjoin(Defect.model)
            .outerjoin(Defect.defect_mode)
            .outerjoin(Defect.employee)
            .order_by(Defect.scan_date.desc(), Defect.scan_time.desc())
            .all()
        )
        result = []
        for i, r in enumerate(records, start=1):
            parsed = parse_model_qr(r.model_qr) if r.model_qr else {}
            m  = r.model        # อาจเป็น None
            dm = r.defect_mode  # อาจเป็น None
            emp = r.employee    # อาจเป็น None

            # ── ชื่อ employee: ลอง name → full_name → work_number ──
            emp_name = ""
            if emp:
                emp_name = emp.name or emp.full_name or emp.work_number or ""

            result.append({
                "no":                i,
                "name":              emp_name,
                "shift":             r.shift or "",
                "group":             r.group or "",
                "shift_group":       f"{r.shift}/{r.group}" if r.shift and r.group else (r.shift or ""),
                "scan_date":         r.scan_date,
                "scan_time":         r.scan_time,
                "model_qr":          r.model_qr        or "",
                "line":              parsed.get("line", r.line or ""),
                "part_no":           parsed.get("part_no", r.part_no or ""),
                "model_name":        m.model_name      if m else "",
                "defect_qr":         r.defect_qr       or "",
                "defect_mode":       dm.defect_mode    if dm else "",
                "defect_code":       dm.defect_code    if dm else "",
                "defect_by_process": dm.defect_by_process if dm else "",
                "defect_type":       dm.defect_type    if dm else "",
                "core_no":           parsed.get("core_no", ""),
                "prod_date":         parsed.get("prod_date", ""),
                "prod_time":         parsed.get("prod_time", ""),
                "ph_top":            m.ph_top           if m else "",
                "die_list_ph_top":   m.die_list_ph_top  if m else "",
                "ph_btm":            m.ph_btm           if m else "",
                "die_list_ph_btm":   m.die_list_ph_btm  if m else "",
                "th_top":            m.th_top           if m else "",
                "th_btm":            m.th_btm           if m else "",
                "work_tag":          parsed.get("work_tag", ""),
            })
        return result
    finally:
        db.close()

def record_report():
    db = SessionLocal()
    try:
        records = db.query(Report).order_by(Report.date_day.desc()).all()
        result  = []
        for i, r in enumerate(records, start=1):
            result.append({
                "no":                i,
                "mode":              r.mode,
                "assumption_detail": r.assumption_detail,
                "assumption_img_url":r.assumption_img_url,
                "action_detail":     r.action_detail,
                "action_img_url":    r.action_img_url,
                "date_day":          r.date_day,
                "pic":               r.pic,
                "progress":          r.progress,
                "status":            r.status,
            })
        return result
    finally:
        db.close()

# ─── Delete ───────────────────────────────────────────────────────── #
def del_volume(no: int):
    db = SessionLocal()
    try:
        subq  = select(Volume.no, func.row_number().over(order_by=[Volume.scan_date.desc(), Volume.scan_time.desc()]).label("rn")).subquery()
        db_no = db.execute(select(subq.c.no).where(subq.c.rn == no)).scalar()
        if db_no:
            db.delete(db.query(Volume).filter(Volume.no == db_no).first())
            db.commit()
            return True
        return False
    finally:
        db.close()

def del_defect(no: int):
    db = SessionLocal()
    try:
        subq  = select(Defect.no, func.row_number().over(order_by=[Defect.scan_date.desc(), Defect.scan_time.desc()]).label("rn")).subquery()
        db_no = db.execute(select(subq.c.no).where(subq.c.rn == no)).scalar()
        if db_no:
            db.delete(db.query(Defect).filter(Defect.no == db_no).first())
            db.commit()
            return True
        return False
    finally:
        db.close()

def del_report(no: int):
    db = SessionLocal()
    try:
        subq  = select(Report.no, func.row_number().over(order_by=[Report.date_day.desc()]).label("rn")).subquery()
        db_no = db.execute(select(subq.c.no).where(subq.c.rn == no)).scalar()
        if db_no:
            db.delete(db.query(Report).filter(Report.no == db_no).first())
            db.commit()
            return True
        return False
    finally:
        db.close()

# ─── Filter ───────────────────────────────────────────────────────── #
def filter_defect(data, date_type="scan", date_from=None, date_to=None,
                  shift=None, name=None, defect_mode=None, model=None, line=None):
    f = data
    if date_from and date_to:
        if date_type == "scan":
            # scan_date เป็น date object → เทียบกับ date object ตรงได้
            f = [r for r in f if r["scan_date"] and date_from <= r["scan_date"] <= date_to]
        else:
            # prod_date เป็น string DDMMYY → แปลงเป็น date แล้วเทียบ
            from datetime import date as _date
            def _to_date(s):
                s = str(s or "").strip()
                if len(s) == 6:
                    try:
                        return _date(2000 + int(s[4:6]), int(s[2:4]), int(s[0:2]))
                    except Exception:
                        return None
                return None
            f = [r for r in f if _to_date(r.get("prod_date")) and
                 date_from <= _to_date(r.get("prod_date")) <= date_to]

    if shift:       f = [r for r in f if r["shift"]       == shift]
    if name:        f = [r for r in f if r["name"]        == name]
    if defect_mode: f = [r for r in f if r["defect_mode"] == defect_mode]
    if model:       f = [r for r in f if r["model_name"]  == model]
    if line:        f = [r for r in f if r["line"]        == line]
    return f

def filter_volume(data, date_from=None, date_to=None, shift=None, model=None, line=None):
    f = data
    if date_from and date_to:
        # scan_date เป็น date object → เทียบตรง
        f = [r for r in f if r["scan_date"] and date_from <= r["scan_date"] <= date_to]
    if shift: f = [r for r in f if r["shift"]      == shift]
    if model: f = [r for r in f if r["model_name"] == model]
    if line:  f = [r for r in f if r["line"]        == line]
    return f

def filter_report(data, date_from=None, date_to=None, status=None, mode=None):
    f = data
    if date_from and date_to:
        f = [r for r in f if r["date_day"] and date_from <= r["date_day"] <= date_to]
    if status: f = [r for r in f if r["status"] == status]
    if mode:   f = [r for r in f if r["mode"]   == mode]
    return f