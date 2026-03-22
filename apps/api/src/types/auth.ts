export type UserRole = "admin" | "operator" | "viewer";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  disabled?: boolean;
}

export interface UsersFile {
  users: UserRecord[];
}
