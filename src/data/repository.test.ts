import "fake-indexeddb/auto";
import { test } from "vitest";
import { DATA_CASES } from "../../tests/shared/data-contract";
import { withIsolatedDatabase } from "../../tests/helpers/database-isolation";
for (const entry of DATA_CASES)
  test(entry.name, () => withIsolatedDatabase(entry.run));
