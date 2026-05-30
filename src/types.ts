export type Board = {
  id: string;
  title: string;
  created_at?: string;
};

export type BoardItem = {
  id: string;
  board_id: string;
  type: 'photo' | 'drawing';
  image_url: string;
  uploader_name: string | null;
  caption: string | null;
  rotate: number;
  created_at: string;
};
