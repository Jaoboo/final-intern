from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..database.database import get_db, Employee
from ..auth_utils import verify_password, create_access_token

router = APIRouter(tags=["auth"])


@router.post("/token")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Login ด้วย work_number (username field) + password
    คืน access_token แบบ JWT
    """
    emp = db.query(Employee).filter(Employee.work_number == form.username).first()

    if not emp:
        raise HTTPException(status_code=401, detail="รหัสพนักงานไม่ถูกต้อง")
    if not emp.is_active:
        raise HTTPException(status_code=401, detail="บัญชีนี้ถูกระงับการใช้งาน")
    if not emp.hashed_password or not verify_password(form.password, emp.hashed_password):
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง")

    token = create_access_token(emp)
    return {"access_token": token, "token_type": "bearer"}