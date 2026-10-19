
import getpass

from sqlalchemy import select
from pwdlib import PasswordHash

from app.database import SessionLocal
from app.models import User

password_hash = PasswordHash.recommended()


def main() -> None:
    name = input("Admin name: ").strip()
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password (hidden): ")

    if not name or len(password) < 12:
        raise SystemExit("Name is required; password must be at least 12 characters.")

    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.email == email))

        if existing:
            raise SystemExit("That email already exists; no account was changed.")

        admin = User(
            name=name,
            email=email,
            password_hash=password_hash.hash(password),
            is_active=True,
            is_admin=True,
        )

        db.add(admin)
        db.commit()

    print("Administrator created.")


if __name__ == "__main__":
    main()
