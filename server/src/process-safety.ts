export function installProcessSafetyHandlers(): void {
  process.on("uncaughtException", (error) => {
    console.error("fatal_uncaught_exception", error.name);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("fatal_unhandled_rejection", reason instanceof Error ? reason.name : typeof reason);
    process.exit(1);
  });
}
