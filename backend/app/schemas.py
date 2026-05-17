from pydantic import BaseModel
from enum import Enum
from typing import Optional
from datetime import date


# ── Role ──────────────────────────────────────────────────────────────────────
class Role(str, Enum):
    admin      = "admin"
    supervisor = "supervisor"
    operator   = "operator"


# ── Employee Schemas ──────────────────────────────────────────────────────────
class EmployeeCreate(BaseModel):
    work_number: str
    full_name:   str
    department:  str
    position:    str
    role:        Role = Role.operator
    password:    str

class EmployeeUpdate(BaseModel):
    full_name:  Optional[str]  = None
    department: Optional[str]  = None
    position:   Optional[str]  = None
    role:       Optional[Role] = None
    is_active:  Optional[bool] = None
    password:   Optional[str]  = None

class EmployeeResponse(BaseModel):
    work_number: str
    full_name:   str
    department:  str
    position:    str
    role:        Role
    is_active:   bool

    class Config:
        from_attributes = True


# ── Volume / Defect / Report Form Schemas (เดิม — ห้ามลบ) ────────────────────
class VolumeFormInsert(BaseModel):
    v_model:     str
    v_shift:     str
    v_line:      str
    v_quantity:  int
    v_prod_time: str

class DefectFormInsert(BaseModel):
    d_name:      str
    d_shift:     str
    d_qr_model:  list[str]
    d_qr_defect: str

class ReportFormInsert(BaseModel):
    r_mode:          str
    r_assump_detail: str
    r_assump_img:    Optional[str] = None
    r_action_detail: str
    r_action_img:    Optional[str] = None
    r_date:          date
    r_pic:           str
    r_progress:      int
    r_status:        str


# ── TSD Expense Form Schema ───────────────────────────────────────────────────
class TSDExpenseInsert(BaseModel):
    work_number: Optional[str] = None  # lookup by work_number (แนะนำ)
    name:        Optional[str] = None  # fallback: employee.name (FK เดิม)
    shift:       str                   # "A" หรือ "B"
    date_day:    Optional[date] = None # default = today
    scrap_code:  str
    item:        str
    price:       float
    quantity:    float
    unit:        str

# ─── Form Submission ──────────────────────────────────────────────── #
class FormDefectBody(BaseModel):
    name:              str
    line:              str
    part_no:           str
    core_no:           str
    model_name:        str
    production_date:   str
    production_time:   str
    work_tag:          str
    group:             str
    shift:             str
    ph_top:            str
    die_list_ph_top:   str
    ph_btm:            str
    die_list_ph_btm:   str
    th_top:            str
    th_btm:            str
    defect_item:       str
    defect_mode:       str
    defect_code:       str
    defect_by_process: str
    defect_type:       str
    model_qr:          list[str] | str
    defect_qr:         str
    date_day:          str
    time:              str

class FormVolumeBody(BaseModel):
    name:            Optional[str] = ""
    line:            str
    part_no:         str
    core_no:         Optional[str] = ""
    model_name:      str
    production_date: str
    production_time: Optional[str] = ""
    work_tag:        Optional[str] = ""
    group:           Optional[str] = ""
    shift:           str
    quantity:        int
    ph_top:          Optional[str] = ""
    die_list_ph_top: Optional[str] = ""
    ph_btm:          Optional[str] = ""
    die_list_ph_btm: Optional[str] = ""
    th_top:          Optional[str] = ""
    th_btm:          Optional[str] = ""
    date_day:        str
    time:            str