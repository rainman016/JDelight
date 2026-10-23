import "fake-indexeddb/auto";
import { test } from "vitest";
import { WORKFLOW_CASES } from "../../tests/shared/workflow-contract";
import { withIsolatedDatabase } from "../../tests/helpers/database-isolation";
for (const entry of WORKFLOW_CASES)
  test(entry.name, () => withIsolatedDatabase(entry.run));
