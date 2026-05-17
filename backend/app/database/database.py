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
    return str(no)

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
            # สร้าง set ของ model_name ที่มีอยู่จริงใน DB
            valid_models = {r.model_name for r in db.query(Model.model_name).all()}
            try:
                df = pd.read_csv(VOLUMEFORM_PATH)
                skipped = 0
                for _, row in df.iterrows():
                    model_name = str(row["Model"]).strip()
                    if model_name not in valid_models:
                        print(f"[csv] Volume skip: model '{model_name}' not in DB")
                        skipped += 1
                        continue
                    try:
                        shift, group = _parse_shift_group(str(row["Shift"]))
                        scan_dt = datetime.strptime(
                            f"{row['Scan date']} {row['Scan time']}", "%d-%m-%Y %H:%M:%S"
                        )
                        db.add(Volume(
                            model_name = model_name,
                            quantity   = int(row["Quantity"]),
                            line       = str(row["Line"]).strip(),
                            prod_date  = str(row["Production date"]).strip(),
                            shift      = shift,
                            group      = group,
                            scan_date  = scan_dt.date(),
                            scan_time  = scan_dt.time(),
                        ))
                    except Exception as row_err:
                        skipped += 1
                        print(f"[csv] Volume row skip: {row_err}")
                        db.rollback()
                db.commit()
                print(f"[csv] Volume loaded ({len(df) - skipped} rows, {skipped} skipped)")
            except Exception as e:
                db.rollback()
                print(f"[csv] Volume FAILED: {e}")

        # ══ 5. Defect history ══════════════════════════════════════════
        # FK: employee.name, model.part_no, defect_mode.defect_item
        # ทั้งหมดต้อง commit ก่อนแล้ว
        if DEFECTFORM_PATH and db.query(Defect).count() == 0:
            print(f"[csv] loading Defect from {DEFECTFORM_PATH}")
            valid_employees  = {r.name for r in db.query(Employee.name).all() if r.name}
            valid_part_nos   = {r.part_no for r in db.query(Model.part_no).all()}
            valid_defect_items = {r.defect_item for r in db.query(DefectMode.defect_item).all()}
            try:
                df = pd.read_csv(DEFECTFORM_PATH)
                skipped = 0
                for _, row in df.iterrows():
                    emp_name    = str(row["Name"]).strip()
                    defect_item = _defect_item_key(int(row["Defect item no."]))
                    model_qr    = str(row["Side plate QR code"]).strip()
                    parsed      = parse_model_qr(model_qr)

                    # ตรวจ FK ก่อน insert
                    fk_errors = []
                    if emp_name not in valid_employees:
                        fk_errors.append(f"employee '{emp_name}' not found")
                    if parsed["part_no"] not in valid_part_nos:
                        fk_errors.append(f"part_no '{parsed['part_no']}' not found")
                    if defect_item not in valid_defect_items:
                        fk_errors.append(f"defect_item '{defect_item}' not found")
                    if fk_errors:
                        print(f"[csv] Defect row skip FK: {', '.join(fk_errors)}")
                        skipped += 1
                        continue

                    try:
                        shift, group = _parse_shift_group(str(row["Shift"]))
                        scan_dt = datetime.strptime(
                            f"{row['Scan date']} {row['Scan time']}", "%Y-%m-%d %H:%M:%S"
                        )
                        db.add(Defect(
                            name      = emp_name,
                            part_no   = parsed["part_no"],
                            line      = parsed["line"],
                            model_qr  = model_qr,
                            defect_qr = defect_item,
                            shift     = shift,
                            group     = group,
                            scan_date = scan_dt.date(),
                            scan_time = scan_dt.time(),
                        ))
                    except Exception as row_err:
                        skipped += 1
                        print(f"[csv] Defect row skip: {row_err}")
                        db.rollback()
                db.commit()
                print(f"[csv] Defect loaded ({len(df) - skipped} rows, {skipped} skipped)")
            except Exception as e:
                db.rollback()
                print(f"[csv] Defect FAILED: {e}")

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