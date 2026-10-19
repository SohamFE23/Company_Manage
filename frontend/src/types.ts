export type WorkStatus = "open" | "in_progress" | "blocked" | "resolved";
export type Priority = "low" | "medium" | "high" | "critical";
export type TeamRole = "manager" | "member" | "viewer" | "admin";

export type WorkItem = {
  id: number;
  title: string;
  description: string | null;
  status: WorkStatus;
  priority: Priority;
  team_id: number;
  assignee_id: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  team_name?: string | null;
  assignee_name?: string | null;
};

export type WorkItemList = {
  items: WorkItem[];
  total: number;
};

export type ActivityEvent = {
  id: number;
  action: string;
  description: string;
  actor_name: string | null;
  created_at: string;
  old_value: string | null;
  new_value: string | null;
};

export type Team = {
  id: number;
  name: string;
  description?: string | null;
  member_count?: number;
  my_role?: TeamRole | null;
};

export type TeamMember = {
  user_id: number;
  name: string;
  email: string;
  role: TeamRole;
  is_active: boolean;
};

export function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
}
