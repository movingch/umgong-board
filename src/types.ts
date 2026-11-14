export type Board = {
  id: string;
  title: string;
  owner_id?: string | null;
  created_at?: string;
  locked: boolean;
  notice?: string | null;
};

export type BoardItem = {
  id: string;
  board_id: string;
  type: 'photo' | 'drawing' | 'text';
  image_url: string;
  uploader_name: string | null;
  caption: string | null;
  rotate: number;
  created_at: string;
  likes: number;
  reactions?: Record<string, number> | null;
};
