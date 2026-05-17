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
                skipped.append({
                    "qr":        qr,
                    "scan_date": str(existing.scan_date),
                    "scan_time": str(existing.scan_time),
                    "shift":     existing.shift,
                    "name":      existing.employee.name,
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
                skipped.append({
                    "qr":        qr,
                    "scan_date": str(existing2.scan_date) if existing2 else "",
                    "scan_time": str(existing2.scan_time) if existing2 else "",
                    "shift":     existing2.shift          if existing2 else "",
                    "name":      existing2.employee.name  if existing2 else "",
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
        records = db.query(Volume).join(Volume.model).order_by(Volume.scan_date.desc(), Volume.scan_time.desc()).all()
        result  = []
        for i, r in enumerate(records, start=1):
            result.append({
                "no":              i,
                "part_no":         r.model.part_no,
                "model_name":      r.model.model_name,
                "prod_date":       r.prod_date,
                "quantity":        r.quantity,
                "line":            r.line,
                "scan_date":       r.scan_date,
                "scan_time":       r.scan_time,
                "shift":           r.shift,
                "group":           r.group,
                "shift_group":     f"{r.shift}/{r.group}" if r.shift and r.group else (r.shift or ""),
                "ph_top":          r.model.ph_top,
                "die_list_ph_top": r.model.die_list_ph_top,
                "ph_btm":          r.model.ph_btm,
                "die_list_ph_btm": r.model.die_list_ph_btm,
                "th_top":          r.model.th_top,
                "th_btm":          r.model.th_btm,
            })
        return result
    finally:
        db.close()

def record_defect():
    db = SessionLocal()
    try:
        records = (
            db.query(Defect)
            .join(Defect.model)
            .join(Defect.defect_mode)
            .join(Defect.employee)
            .order_by(Defect.scan_date.desc(), Defect.scan_time.desc())
            .all()
        )
        result = []
        for i, r in enumerate(records, start=1):
            parsed = parse_model_qr(r.model_qr)
            result.append({
                "no":                i,
                "name":              r.employee.name,
                "shift":             r.shift,
                "group":             r.group,
                "shift_group":       f"{r.shift}/{r.group}" if r.shift and r.group else (r.shift or ""),
                "scan_date":         r.scan_date,
                "scan_time":         r.scan_time,
                "model_qr":          r.model_qr,
                "line":              parsed["line"],
                "part_no":           parsed["part_no"],
                "model_name":        r.model.model_name,
                "defect_qr":         r.defect_qr,
                "defect_mode":       r.defect_mode.defect_mode,
                "defect_code":       r.defect_mode.defect_code,
                "defect_by_process": r.defect_mode.defect_by_process,
                "defect_type":       r.defect_mode.defect_type,
                "core_no":           parsed["core_no"],
                "prod_date":         parsed["prod_date"],
                "prod_time":         parsed["prod_time"],
                "ph_top":            r.model.ph_top,
                "die_list_ph_top":   r.model.die_list_ph_top,
                "ph_btm":            r.model.ph_btm,
                "die_list_ph_btm":   r.model.die_list_ph_btm,
                "th_top":            r.model.th_top,
                "th_btm":            r.model.th_btm,
                "work_tag":          parsed["work_tag"],
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
        key = "scan_date" if date_type == "scan" else "prod_date"
        f = [r for r in f if date_from <= r[key] <= date_to]
    if shift:       f = [r for r in f if r["shift"]       == shift]
    if name:        f = [r for r in f if r["name"]        == name]
    if defect_mode: f = [r for r in f if r["defect_mode"] == defect_mode]
    if model:       f = [r for r in f if r["model_name"]  == model]
    if line:        f = [r for r in f if r["line"]        == line]
    return f

def filter_volume(data, date_from=None, date_to=None, shift=None, model=None, line=None):
    f = data
    if date_from and date_to:
        f = [r for r in f if date_from <= r["scan_date"] <= date_to]
    if shift: f = [r for r in f if r["shift"]      == shift]
    if model: f = [r for r in f if r["model_name"] == model]
    if line:  f = [r for r in f if r["line"]        == line]
    return f

def filter_report(data, date_from=None, date_to=None, status=None, mode=None):
    f = data
    if date_from and date_to:
        f = [r for r in f if date_from <= r["date_day"] <= date_to]
    if status: f = [r for r in f if r["status"] == status]
    if mode:   f = [r for r in f if r["mode"]   == mode]
    return f