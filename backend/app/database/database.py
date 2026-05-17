from datetime import date, datetime
from pathlib import Path
import enum
import re

import pandas as pd
from sqlalchemy import (
    Boolean, DateTime, Enum, Time, UniqueConstraint,
    create_engine, Column, Integer, String, Date, ForeignKey,
)
from sqlalchemy.orm import sessionmaker, DeclarativeBase, relationship
from dotenv import load_dotenv
import os

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

DATABASE_URL = f"sqlite:///{BASE_DIR / 'app.db'}"
DUCKDB_PATH  = str(BASE_DIR / "data" / "app.duckdb")

MODEL_PATH      = os.getenv("MODEL")
DEFECT_PATH     = os.getenv("DEFECT")
EMPLOYEE_PATH   = os.getenv("EMPLOYEE")
DEFECTFORM_PATH = os.getenv("DEFECT_HISTORY")
VOLUMEFORM_PATH = os.getenv("VOLUME_HISTORY")
REPORTFORM_PATH = os.getenv("REPORT_HISTORY")

engine       = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)

class Base(DeclarativeBase):
    pass

class SharedBase(Base):
    __abstract__ = True

    shift     = Column(String)
    group     = Column(String)
    scan_date = Column(Date, default=date.today)
    scan_time = Column(Time, default=datetime.now)
    line      = Column(String)

# ─── Role Enum ────────────────────────────────────────────────────── #
class Role(str, enum.Enum):
    admin      = "admin"
    supervisor = "supervisor"
    operator   = "operator"

# ─── Master Tables ────────────────────────────────────────────────── #
class Model(Base):
    __tablename__ = "model"

    part_no         = Column(String, primary_key=True)
    model_name      = Column(String, index=True)
    ph_top          = Column(String)
    die_list_ph_top = Column(String)
    ph_btm          = Column(String)
    die_list_ph_btm = Column(String)
    th_top          = Column(String)
    th_btm          = Column(String)

class DefectMode(Base):
    __tablename__ = "defect_mode"

    defect_item       = Column(String, primary_key=True)
    defect_mode       = Column(String)
    defect_code       = Column(String)
    defect_by_process = Column(String)
    defect_type       = Column(String)

class Employee(Base):
    __tablename__ = "employee"

    work_number     = Column(String, primary_key=True)
    name            = Column(String, unique=True, index=True, nullable=True)
    full_name       = Column(String, nullable=False, default="")
    department      = Column(String, nullable=False, default="")
    position        = Column(String, nullable=False, default="")
    hashed_password = Column(String, nullable=True)
    role            = Column(Enum(Role), default=Role.operator, nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime(timezone=True), default=datetime.now)

# ─── Helpers ──────────────────────────────────────────────────────── #
def _parse_shift_group(raw: str) -> tuple[str, str]:
    if "/" in raw:
        shift, group = raw.split("/", 1)
        return shift.strip(), group.strip()
    return raw.strip(), ""

def _defect_item_key(no: int) -> str:
    """
    คืน defect_item key — ลอง str(no) ก่อน ถ้าไม่ match ให้ caller ลอง variants อื่น
    """
    return str(no)

def _defect_item_variants(no: int) -> list:
    """คืน key ที่เป็นไปได้ทั้งหมด: '1', '01', '001', '0001'"""
    s = str(no)
    return [s, s.zfill(2), s.zfill(3), s.zfill(4)]

def _name_to_work_number(name: str, counter: int) -> str:
    """
    สร้าง work_number จาก name สำหรับ CSV import เดิมที่ไม่มี work_number
    ใช้ counter (1-based) แทน pandas index เพื่อความแน่นอน
    """
    return f"EMP{counter:03d}"

def _default_password(work_number: str) -> str:
    """
    สร้าง hashed password เริ่มต้น = work_number ตัวเอง
    เช่น EMP001 → hash("EMP001")
    import แบบ lazy เพื่อหลีกเลี่ยง circular import
    """
    from passlib.context import CryptContext
    _ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    return _ctx.hash(work_number)


def parse_model_qr(model_qr: str) -> dict:
    return {
        "part_no":   model_qr[:13],
        "line":      model_qr[13:16],
        "core_no":   model_qr[14:16],
        "prod_date": model_qr[16:22],
        "prod_time": model_qr[22:28],
        "work_tag":  model_qr[28:],
    }

# ─── Transaction Tables ───────────────────────────────────────────── #
class Volume(SharedBase):
    __tablename__ = "volume"

    no         = Column(Integer, primary_key=True, autoincrement=True)
    model_name = Column(String, ForeignKey("model.model_name"))
    quantity   = Column(Integer)
    prod_date  = Column(String)

    model = relationship("Model")

    __table_args__ = (
        UniqueConstraint(
            "model_name", "scan_date", "shift", "scan_time",
            name="uq_volume_model_date_shift_time",
        ),
    )

class Defect(SharedBase):
    __tablename__ = "defect"

    no        = Column(Integer, primary_key=True, autoincrement=True)
    name      = Column(String, ForeignKey("employee.name"))
    part_no   = Column(String, ForeignKey("model.part_no"))
    model_qr  = Column(String)
    defect_qr = Column(String, ForeignKey("defect_mode.defect_item"))

    employee    = relationship("Employee")
    model       = relationship("Model")
    defect_mode = relationship("DefectMode", foreign_keys="[Defect.defect_qr]")

    __table_args__ = (
        UniqueConstraint("model_qr", "defect_qr", name="uq_defect_modelqr_defectqr"),
    )

class TSDExpense(Base):
    __tablename__ = "tsd_expense"

    no          = Column(Integer, primary_key=True, autoincrement=True)
    date_day    = Column(Date, default=date.today)
    shift       = Column(String)
    group       = Column(String)
    name        = Column(String, ForeignKey("employee.name"))
    scrap_code  = Column(String)
    item        = Column(String)
    price       = Column(Integer, default=0)
    quantity    = Column(Integer, default=0)
    unit        = Column(String)

    employee = relationship("Employee")

class Report(Base):
    __tablename__ = "report"

    no                 = Column(Integer, primary_key=True, autoincrement=True)
    mode               = Column(String)
    assumption_detail  = Column(String)
    assumption_img_url = Column(String)
    action_detail      = Column(String)
    action_img_url     = Column(String)
    date_day           = Column(Date)
    pic                = Column(String)
    progress           = Column(Integer)
    status             = Column(String)

class CorrectionNote(Base):
    __tablename__ = "correction_note"

    no             = Column(Integer, primary_key=True, autoincrement=True)
    note_date      = Column(Date, unique=True, nullable=False)
    line           = Column(String, nullable=False)
    defect_type    = Column(String, nullable=False)
    changing_point = Column(String, nullable=False)
    created_at     = Column(DateTime, default=datetime.now)


# ─── CSV Loader ───────────────────────────────────────────────────── #
def load_csv_to_db():
    """
    โหลด CSV แต่ละตาราง แบบแยก commit ต่อตาราง
    ลำดับสำคัญ: Model → DefectMode → Employee → Volume → Defect
    (FK dependency: Volume→Model, Defect→Employee+Model+DefectMode)
    """
    db = SessionLocal()
    try:
        # ══ 1. Model ══════════════════════════════════════════════════
        if db.query(Model).count() == 0 and MODEL_PATH:
            print(f"[csv] loading Model from {MODEL_PATH}")
            try:
                df = pd.read_csv(MODEL_PATH)
                skipped = 0
                for _, row in df.iterrows():
                    try:
                        db.add(Model(
                            part_no         = str(row["Part no."]).strip(),
                            model_name      = str(row["Model"]).strip(),
                            ph_top          = str(row.get("P/H Top", "")).strip(),
                            die_list_ph_top = str(row.get("Die List[P/H Top]", "")).strip(),
                            ph_btm          = str(row.get("P/H Btm", "")).strip(),
                            die_list_ph_btm = str(row.get("Die List[P/H Btm]", "")).strip(),
                            th_top          = str(row.get("T/H Top", "")).strip(),
                            th_btm          = str(row.get("T/H Btm", "")).strip(),
                        ))
                    except Exception as row_err:
                        skipped += 1
                        print(f"[csv] Model row skip: {row_err}")
                        db.rollback()
                db.commit()
                print(f"[csv] Model loaded ({len(df) - skipped} rows, {skipped} skipped)")
            except Exception as e:
                db.rollback()
                print(f"[csv] Model FAILED: {e}")

        # ══ 2. DefectMode ═════════════════════════════════════════════
        if db.query(DefectMode).count() == 0 and DEFECT_PATH:
            print(f"[csv] loading DefectMode from {DEFECT_PATH}")
            try:
                df = pd.read_csv(DEFECT_PATH)
                skipped = 0
                for _, row in df.iterrows():
                    try:
                        db.add(DefectMode(
                            defect_item       = str(row["Defect Item no."]).strip(),
                            defect_mode       = str(row.get("Defect mode", "")).strip(),
                            defect_code       = str(row.get("Defect code", "")).strip(),
                            defect_by_process = str(row.get("Defect by process", "")).strip(),
                            defect_type       = str(row.get("Type", "")).strip(),
                        ))
                    except Exception as row_err:
                        skipped += 1
                        print(f"[csv] DefectMode row skip: {row_err}")
                        db.rollback()
                db.commit()
                print(f"[csv] DefectMode loaded ({len(df) - skipped} rows, {skipped} skipped)")
            except Exception as e:
                db.rollback()
                print(f"[csv] DefectMode FAILED: {e}")

        # ══ 3. Employee ═══════════════════════════════════════════════
        if db.query(Employee).count() == 0 and EMPLOYEE_PATH:
            print(f"[csv] loading Employee from {EMPLOYEE_PATH}")
            try:
                df = pd.read_csv(EMPLOYEE_PATH)
                skipped  = 0
                counter  = 1   # ← ใช้ counter แทน pandas idx
                seen_names = set()
                for _, row in df.iterrows():
                    name = str(row["Name"]).strip()
                    if not name or name.lower() == "nan":
                        skipped += 1
                        continue
                    # ป้องกัน name ซ้ำในไฟล์เดียวกัน
                    if name in seen_names:
                        print(f"[csv] Employee duplicate name skip: {name}")
                        skipped += 1
                        continue
                    seen_names.add(name)
                    try:
                        # default password = work_number (ให้ admin เปลี่ยนทีหลัง)
                        wn = _name_to_work_number(name, counter)
                        db.add(Employee(
                            work_number     = wn,
                            name            = name,
                            full_name       = name,
                            department      = str(row.get("Department", "")).strip(),
                            position        = str(row.get("Position", "")).strip(),
                            role            = Role.operator,
                            is_active       = True,
                            hashed_password = _default_password(wn),
                        ))
                        counter += 1
                    except Exception as row_err:
                        skipped += 1
                        print(f"[csv] Employee row '{name}' skip: {row_err}")
                        db.rollback()
                db.commit()
                print(f"[csv] Employee loaded ({counter - 1} rows, {skipped} skipped)")
            except Exception as e:
                db.rollback()
                print(f"[csv] Employee FAILED: {e}")

        # ══ 4. Volume history ═════════════════════════════════════════
        # ต้อง commit Model ก่อน เพราะ Volume.model_name FK → model.model_name
        if VOLUMEFORM_PATH and db.query(Volume).count() == 0:
            print(f"[csv] loading Volume from {VOLUMEFORM_PATH}")
            valid_models = {r.model_name for r in db.query(Model.model_name).all()}

            _DATE_FMTS_V = [
                "%d-%m-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S",
                "%d/%m/%Y %H:%M:%S", "%Y/%m/%d %H:%M:%S",
                "%d-%m-%Y %H:%M",    "%Y-%m-%d %H:%M",
            ]
            def _parse_vol_dt(d_str: str, t_str: str) -> datetime:
                combined = f"{d_str} {t_str}".strip()
                for fmt in _DATE_FMTS_V:
                    try:
                        return datetime.strptime(combined, fmt)
                    except ValueError:
                        pass
                raise ValueError(f"ไม่รู้จัก date format: {combined!r}")

            try:
                df = pd.read_csv(VOLUMEFORM_PATH)
                print(f"[csv] Volume CSV columns: {list(df.columns)}")
                print(f"[csv] Volume CSV rows: {len(df)}")
                skipped  = 0
                inserted = 0
                for _, row in df.iterrows():
                    model_name = str(row.get("Model", row.get("model_name", ""))).strip()
                    if not model_name or model_name.lower() == "nan":
                        skipped += 1
                        continue
                    if model_name not in valid_models:
                        print(f"[csv] Volume skip: model '{model_name}' not in DB")
                        skipped += 1
                        continue
                    try:
                        shift, group = _parse_shift_group(str(row.get("Shift", "A")))
                        scan_dt = _parse_vol_dt(
                            str(row.get("Scan date", "")),
                            str(row.get("Scan time", "00:00:00")),
                        )
                        db.add(Volume(
                            model_name = model_name,
                            quantity   = int(float(str(row.get("Quantity", row.get("qty", 0))))),
                            line       = str(row.get("Line", row.get("line", ""))).strip(),
                            prod_date  = str(row.get("Production date", row.get("prod_date", ""))).strip(),
                            shift      = shift,
                            group      = group,
                            scan_date  = scan_dt.date(),
                            scan_time  = scan_dt.time(),
                        ))
                        db.flush()
                        inserted += 1
                    except Exception as row_err:
                        db.rollback()
                        skipped += 1
                        print(f"[csv] Volume row skip: {row_err}")
                db.commit()
                print(f"[csv] Volume loaded: {inserted} inserted, {skipped} skipped")
            except Exception as e:
                db.rollback()
                print(f"[csv] Volume FAILED: {e}")
                import traceback; traceback.print_exc()

        # ══ 5. Defect history ══════════════════════════════════════════
        # FK: employee.name, model.part_no, defect_mode.defect_item
        if DEFECTFORM_PATH and db.query(Defect).count() == 0:
            print(f"[csv] loading Defect from {DEFECTFORM_PATH}")

            # ── valid sets ──
            valid_employees    = {r.name for r in db.query(Employee.name).all() if r.name}
            # รองรับ employee ที่ name เป็น full_name ด้วย (กรณี import ใหม่)
            valid_employees   |= {r.full_name for r in db.query(Employee).all() if r.full_name}
            valid_part_nos     = {r.part_no for r in db.query(Model.part_no).all()}
            valid_defect_items = {r.defect_item for r in db.query(DefectMode.defect_item).all()}

            # ── สร้าง map: name/full_name → employee.name (FK field) ──
            emp_name_map: dict = {}
            for emp in db.query(Employee).all():
                if emp.name:
                    emp_name_map[emp.name]      = emp.name
                if emp.full_name:
                    emp_name_map[emp.full_name] = emp.name or emp.full_name

            # ── date format variants ──
            _DATE_FMTS = ["%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M:%S",
                          "%Y/%m/%d %H:%M:%S", "%d/%m/%Y %H:%M:%S"]
            def _parse_dt(d_str: str, t_str: str) -> datetime:
                combined = f"{d_str} {t_str}".strip()
                for fmt in _DATE_FMTS:
                    try:
                        return datetime.strptime(combined, fmt)
                    except ValueError:
                        pass
                raise ValueError(f"ไม่รู้จัก date format: {combined!r}")

            try:
                df = pd.read_csv(DEFECTFORM_PATH)
                print(f"[csv] Defect CSV columns: {list(df.columns)}")
                print(f"[csv] Defect CSV rows: {len(df)}")
                skipped    = 0
                inserted   = 0
                fk_missing = {"employee": set(), "part_no": set(), "defect_item": set()}

                for _, row in df.iterrows():
                    raw_name    = str(row.get("Name", "")).strip()
                    raw_item_no = row.get("Defect item no.", row.get("Defect Item no.", ""))
                    model_qr    = str(row.get("Side plate QR code",
                                     row.get("Side Plate QR code",
                                     row.get("model_qr", "")))).strip()

                    if not model_qr or model_qr.lower() == "nan":
                        skipped += 1
                        continue

                    parsed = parse_model_qr(model_qr)

                    # ── resolve employee name → FK ──
                    fk_name = emp_name_map.get(raw_name)
                    if not fk_name:
                        fk_missing["employee"].add(raw_name)
                        skipped += 1
                        continue

                    # ── resolve defect_item — ลอง multiple formats ──
                    fk_defect = None
                    try:
                        item_no = int(float(str(raw_item_no)))
                        for variant in _defect_item_variants(item_no):
                            if variant in valid_defect_items:
                                fk_defect = variant
                                break
                    except (ValueError, TypeError):
                        # ลองใช้ raw string ตรงๆ
                        raw_s = str(raw_item_no).strip()
                        if raw_s in valid_defect_items:
                            fk_defect = raw_s

                    if not fk_defect:
                        fk_missing["defect_item"].add(str(raw_item_no))
                        skipped += 1
                        continue

                    # ── resolve part_no ──
                    if parsed["part_no"] not in valid_part_nos:
                        fk_missing["part_no"].add(parsed["part_no"])
                        skipped += 1
                        continue

                    # ── insert (แยก session ต่อ row เพื่อ rollback ไม่กระทบ row อื่น) ──
                    try:
                        shift, group = _parse_shift_group(str(row.get("Shift", "A")))
                        scan_dt = _parse_dt(
                            str(row.get("Scan date", "")),
                            str(row.get("Scan time", "00:00:00")),
                        )
                        db.add(Defect(
                            name      = fk_name,
                            part_no   = parsed["part_no"],
                            line      = parsed["line"],
                            model_qr  = model_qr,
                            defect_qr = fk_defect,
                            shift     = shift,
                            group     = group,
                            scan_date = scan_dt.date(),
                            scan_time = scan_dt.time(),
                        ))
                        db.flush()   # ← flush ทีละ row ไม่ rollback ทั้งหมด
                        inserted += 1
                    except Exception as row_err:
                        db.rollback()   # rollback เฉพาะ row นี้
                        skipped += 1
                        print(f"[csv] Defect row skip (insert error): {row_err}")

                db.commit()
                print(f"[csv] Defect loaded: {inserted} inserted, {skipped} skipped")
                if fk_missing["employee"]:
                    print(f"[csv]   employee not found ({len(fk_missing['employee'])}): "
                          f"{list(fk_missing['employee'])[:5]}")
                if fk_missing["defect_item"]:
                    print(f"[csv]   defect_item not found ({len(fk_missing['defect_item'])}): "
                          f"{list(fk_missing['defect_item'])[:5]}")
                if fk_missing["part_no"]:
                    print(f"[csv]   part_no not found ({len(fk_missing['part_no'])}): "
                          f"{list(fk_missing['part_no'])[:5]}")
            except Exception as e:
                db.rollback()
                print(f"[csv] Defect FAILED: {e}")
                import traceback; traceback.print_exc()

    finally:
        db.close()


# ─── Session / Init ───────────────────────────────────────────────── #
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)