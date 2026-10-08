// Shared between the "הספרייה המשותפת" API route and its dashboard page.

export const SHARED_BOARD_TOPICS = [
  { id: "holidays", label: "חגים", emoji: "🕎" },
  { id: "health", label: "בריאות ורופאים", emoji: "🩺" },
  { id: "school", label: "גן ובית ספר", emoji: "🏫" },
  { id: "trips", label: "טיולים ויציאות", emoji: "🚌" },
  { id: "feelings", label: "רגשות", emoji: "😊" },
  { id: "food", label: "אוכל", emoji: "🍎" },
  { id: "home", label: "בית ושגרה", emoji: "🏠" },
  { id: "other", label: "אחר", emoji: "✨" },
] as const;

export type SharedBoardTopic = (typeof SHARED_BOARD_TOPICS)[number]["id"];

export type SharedSymbol = { label: string; emoji: string; pictogramId?: number };

export type SharedBoard = {
  id: string;
  authorName: string;
  authorRole: "parent" | "teacher";
  title: string;
  emoji: string;
  topic: string;
  description: string;
  symbols: SharedSymbol[];
  createdAt: string;
  likes: number;
  likedByMe: boolean;
  isMine: boolean;
};

export const isSharedBoardTopic = (value: string): value is SharedBoardTopic =>
  SHARED_BOARD_TOPICS.some((topic) => topic.id === value);
