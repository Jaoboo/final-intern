from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database.database import get_db, Employee, Role   # ← relative import แทน backend.app...

SECRET_KEY = "change-this-to-random-64-char-string"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(employee: Employee) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub":        employee.work_number,
        "full_name":  employee.full_name,
        "department": employee.department,
        "position":   employee.position,
        "role":       employee.role,
        "exp":        expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_employee(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Employee:
    try:
        payload     = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        work_number = payload.get("sub")
        emp = db.query(Employee).filter(Employee.work_number == work_number).first()
        if not emp or not emp.is_active:
            raise HTTPException(status_code=401, detail="User ไม่ถูกต้องหรือถูก deactivate")
        return emp
    except JWTError:
        raise HTTPException(status_code=401, detail="Token ไม่ถูกต้อง")


def require_admin(current: Employee = Depends(get_current_employee)) -> Employee:
    if current.role != Role.admin:
        raise HTTPException(status_code=403, detail="เฉพาะ Admin เท่านั้น")
    return current


def require_supervisor(current: Employee = Depends(get_current_employee)) -> Employee:
    if current.role not in (Role.admin, Role.supervisor):
        raise HTTPException(status_code=403, detail="เฉพาะ Supervisor ขึ้นไปเท่านั้น")
    return current