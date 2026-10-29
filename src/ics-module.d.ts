declare module "*.ics" {
  const text: string;
  export default text;
}
declare module "*.ics?raw" {
  const text: string;
  export default text;
}

// Wrangler bundles .html files as text (dev only: the when2meet fixtures).
declare module "*.html" {
  const text: string;
  export default text;
}
