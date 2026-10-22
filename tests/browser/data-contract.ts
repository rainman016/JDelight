import { DATA_CASES } from "../shared/data-contract";
import { withIsolatedDatabase } from "../helpers/database-isolation";
Object.assign(globalThis, {
  runDataContract: async () => {
    const results: { name: string; passed: boolean; error?: string }[] = [];
    for (const entry of DATA_CASES) {
      try {
        await withIsolatedDatabase(entry.run);
        results.push({ name: entry.name, passed: true });
      } catch (error) {
        results.push({ name: entry.name, passed: false, error: String(error) });
      }
    }
    return results;
  },
});
