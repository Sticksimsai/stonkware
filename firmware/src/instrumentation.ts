// Runs the scheduler inside `next start` so one process does everything.
// Set RUN_SCHEDULER=0 if you run `npm run worker` separately.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./scheduler");
  }
}
