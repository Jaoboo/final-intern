from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database.database import get_db, Employee
from ..auth_utils import hash_password, require_admin  # ← แก้จาก ..auth เป็น ..auth_utils
from ..schemas import EmployeeCreate, EmployeeUpdate, EmployeeResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=list[EmployeeResponse])
def list_users(
    db: Session = Depends(get_db),
    current: Employee = Depends(require_admin),
):
    return db.query(Employee).order_by(Employee.work_number).all()


@router.post("/", response_model=EmployeeResponse, status_code=201)
def create_user(
    body: EmployeeCreate,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_admin),
):
    if db.query(Employee).filter(Employee.work_number == body.work_number).first():
        raise HTTPException(status_code=400, detail="รหัสพนักงานนี้มีอยู่แล้ว")

    emp = Employee(
        work_number     = body.work_number,
        full_name       = body.full_name,
        department      = body.department,
        position        = body.position,
        role            = body.role,
        hashed_password = hash_password(body.password),
        is_active       = True,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


@router.patch("/{work_number}", response_model=EmployeeResponse)
def update_user(
    work_number: str,
    body: EmployeeUpdate,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_admin),
):
    emp = db.query(Employee).filter(Employee.work_number == work_number).first()
    if not emp:
        raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")

    if body.full_name  is not None: emp.full_name  = body.full_name
    if body.department is not None: emp.department = body.department
    if body.position   is not None: emp.position   = body.position
    if body.role       is not None: emp.role       = body.role
    if body.is_active  is not None: emp.is_active  = body.is_active
    if body.password:
        emp.hashed_password = hash_password(body.password)

    db.commit()
    db.refresh(emp)
    return emp


@router.delete("/{work_number}", status_code=204)
def delete_user(
    work_number: str,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_admin),
):
    emp = db.query(Employee).filter(Employee.work_number == work_number).first()
    if not emp:
        raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")
    db.delete(emp)
    db.commit()