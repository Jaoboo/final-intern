from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .database.database import get_db, Employee

SECRET_KEY = "change-this-to-random-64-char-string"   # ← เปลี่ยนก่อน deploy
ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(employee: Employee) -> str:
    expire  = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # ── แก้: ใช้ full_name ก่อน ถ้าว่างค่อย fallback ไป name ──
    full_name = (
        getattr(employee, "full_name", None)
        or getattr(employee, "name", None)
        or ""
    )
    payload = {
        "sub":        employee.work_number,
        "full_name":  full_name,
        "department": getattr(employee, "department", "") or "",
        "position":   getattr(employee, "position", "") or "",
        "role":       str(employee.role.value if hasattr(employee.role, "value") else employee.role),
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
        if not work_number:
            raise HTTPException(status_code=401, detail="Token ไม่มี sub")
        emp = db.query(Employee).filter(Employee.work_number == work_number).first()
        if not emp:
            raise HTTPException(status_code=401, detail="User ไม่ถูกต้อง")
        if not emp.is_active:
            raise HTTPException(status_code=401, detail="User ถูก deactivate")
        return emp
    except JWTError:
        raise HTTPException(status_code=401, detail="Token ไม่ถูกต้อง")


def require_admin(current: Employee = Depends(get_current_employee)) -> Employee:
    role = current.role.value if hasattr(current.role, "value") else str(current.role)
    if role != "admin":
        raise HTTPException(status_code=403, detail="เฉพาะ Admin เท่านั้น")
    return current


def require_supervisor(current: Employee = Depends(get_current_employee)) -> Employee:
    role = current.role.value if hasattr(current.role, "value") else str(current.role)
    if role not in ("admin", "supervisor"):
        raise HTTPException(status_code=403, detail="เฉพาะ Supervisor ขึ้นไปเท่านั้น")
    return current