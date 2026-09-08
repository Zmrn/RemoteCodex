import { Desktop, discover } from "./desktop.mjs";
import { weeklyUsage } from "./usage.mjs";
const [command = "probe", ...args] = process.argv.slice(2);
if (command === "probe") {
  console.log(JSON.stringify(await discover(), null, 2));
} else {
  const d = new Desktop();
  try {
    await d.connect();
    let r;
    if (command === "projects") r = await d.call("list_projects");
    else if (command === "usage")
      r = weeklyUsage(await d.call("get_usage_limits"));
    else if (command === "threads")
      r = await d.call("list_threads", { limit: 50 });
    else if (command === "read")
      r = await d.call("read_thread", {
        threadId: args[0],
        turnLimit: 5,
        includeOutputs: true,
        maxOutputCharsPerItem: 4000,
      });
    else if (command === "owner") r = await d.owner(args[0]);
    else
      throw Error(
        "Use probe | projects | threads | usage | read ID | owner ID",
      );
    console.log(JSON.stringify(r, null, 2));
  } finally {
    d.close();
  }
}
