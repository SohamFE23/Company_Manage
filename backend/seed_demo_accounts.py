
import os

if os.getenv("APP_ENV", "development").strip().lower() == "production":
    raise SystemExit("Demo accounts cannot be seeded in production.")

from getpass import getpass

from sqlalchemy import select
from pwdlib import PasswordHash

from app.database import Base, engine, SessionLocal
from app import models
from app.models import User, Team, TeamMembership

Base.metadata.create_all(bind=engine)

password_hasher = PasswordHash.recommended()

# These accounts are for local development only.
# Each account receives the same password you enter when running the script.
DEMO_USERS = [
    ("OpsWork Admin", "admin@opswork.local", True, "admin"),
    ("Demo Manager", "manager@opswork.local", False, "manager"),
    ("Demo Employee", "employee@opswork.local", False, "member"),
    ("Demo Viewer", "viewer@opswork.local", False, "viewer"),
]


def main():
    password = getpass(
        "Set a demo password for all demo accounts (minimum 12 characters): "
    )
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters.")

    with SessionLocal() as db:
        team = db.scalar(
            select(Team).where(Team.name == "Operations")
        )
        if team is None:
            team = Team(
                name="Operations",
                description="Demo team for OpsWork",
            )
            db.add(team)
            db.flush()

        created = []

        for name, email, is_admin, role in DEMO_USERS:
            user = db.scalar(
                select(User).where(User.email == email)
            )

            if user is None:
                user = User(
                    name=name,
                    email=email,
                    password_hash=password_hasher.hash(password),
                    is_active=True,
                    is_admin=is_admin,
                )
                db.add(user)
                db.flush()
                created.append(email)
            else:
                # Do not overwrite an existing user's password or privileges.
                print(f"Existing account unchanged: {email}")

            membership = db.scalar(
                select(TeamMembership).where(
                    TeamMembership.user_id == user.id,
                    TeamMembership.team_id == team.id,
                )
            )

            if membership is None:
                db.add(
                    TeamMembership(
                        user_id=user.id,
                        team_id=team.id,
                        role=role,
                    )
                )

        db.commit()

    print("\nDemo account setup complete.")
    print("Demo team: Operations")
    print("New accounts created:", ", ".join(created) or "none")
    print("Existing accounts were not reset.")
    print("Use the password you entered for newly created accounts.")
    print("Do not use these demo accounts in production.")


if __name__ == "__main__":
    main()
