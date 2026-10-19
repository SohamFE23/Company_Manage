
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User, Team, TeamMembership

SECRET_KEY = settings.jwt_secret_key
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = settings.token_expire_hours
TOKEN_EXPIRE_HOURS = 8

password_hash = PasswordHash.recommended()

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/login"
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired credentials. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise unauthorized

    user = db.get(User, user_id)

    if user is None or not user.is_active:
        raise unauthorized

    return user


def require_admin(
    user: User = Depends(get_current_user),
) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return user


def require_team_manager(
    team_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Use on endpoints that modify a specific team's settings or members."""
    if user.is_admin:
        return user

    membership = db.scalar(
        select(TeamMembership).where(
            TeamMembership.user_id == user.id,
            TeamMembership.team_id == team_id,
        )
    )

    if membership is None or membership.role.lower() not in {
        "manager",
        "admin",
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team manager access required.",
        )

    return user


@router.post("/login")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # OAuth2PasswordRequestForm calls the field "username".
    # For OpsFlow, users enter their email address in that field.
    email = form.username.strip().lower()

    user = db.scalar(
        select(User).where(User.email == email)
    )

    if (
        user is None
        or not user.is_active
        or not password_hash.verify(form.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
    }


@router.get("/me")
def get_me(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Team, TeamMembership.role)
        .join(
            TeamMembership,
            TeamMembership.team_id == Team.id,
        )
        .where(TeamMembership.user_id == user.id)
        .order_by(Team.name)
    ).all()

    teams = [
        {
            "id": team.id,
            "name": team.name,
            "role": role,
        }
        for team, role in rows
    ]

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "is_admin": user.is_admin,
        "teams": teams,
    }
