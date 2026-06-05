interface Resource {
  id: number; // pk, unq
  url: string; // unq
  status: string; // downloaded, pending, error
  dateUpdated: Date;
}
