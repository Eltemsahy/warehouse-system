if (process.env.NODE_ENV !== "production") {
  const { default: husky } = await import("husky");
  const message = husky();

  if (message) console.log(message);
}
