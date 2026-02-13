// Auto-generated from backend schema — do not edit manually

export type EntryKind = "file" | "directory" | "symlink";

export interface DirEntry {
  name: string;
  kind: EntryKind;
  size: number | null;
  modified: number | null;
}

export interface FileContent {
  content: string;
  size: number;
  is_binary: boolean;
}

export interface RootsResponse {
  roots: string[];
}
