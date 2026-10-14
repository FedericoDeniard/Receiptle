import type { Database } from "./database.types";
import type { TagColor } from "../constants/tags";

export type TagInsert = Database["public"]["Tables"]["tags"]["Insert"];
export type TagUpdate = Database["public"]["Tables"]["tags"]["Update"];

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: TagColor;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionTagLite {
  id: string;
  name: string;
  color: TagColor;
}
