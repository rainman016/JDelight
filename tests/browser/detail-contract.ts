import { JDelightDatabase } from "../../src/data/database";
import { detailFixture } from "../helpers/detail-fixture";
import { runUpgradeContract } from "../shared/upgrade-contract";
Object.assign(globalThis, {
  runUpgradeContract,
  seedDetail: async () => {
    const db = new JDelightDatabase();
    try {
      const data = await detailFixture(db);
      return {
        jobId: data.job.id,
        firstId: data.first.id,
        secondId: data.second.id,
        thirdId: data.third.id,
      };
    } finally {
      db.close();
    }
  },
});
