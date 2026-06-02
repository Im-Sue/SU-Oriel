import assert from "node:assert/strict";

import { test } from "vitest";

import { startProjectionServices } from "./server-bootstrap.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("startProjectionServices recovers project ccbd before starting background workers", async () => {
  const calls: string[] = [];

  const handle = await startProjectionServices({
    recoverProjectCcbdsOnStartup: async () => {
      calls.push("project-ccbd.recover");
    },
    startAnchorDispatchWorker: () => {
      calls.push("anchor-dispatch.worker.start");
      return {
        stop: async () => {
          calls.push("anchor-dispatch.worker.stop");
        }
      };
    },
    startSlotStaleDetector: () => {
      calls.push("slot-stale-detector.start");
      return {
        stop: async () => {
          calls.push("slot-stale-detector.stop");
        }
      };
    },
    startSlotQueueDrain: () => {
      calls.push("slot-queue-drain.start");
      return {
        stop: async () => {
          calls.push("slot-queue-drain.stop");
        }
      };
    }
  });

  assert.deepEqual(calls, [
    "project-ccbd.recover",
    "anchor-dispatch.worker.start",
    "slot-stale-detector.start",
    "slot-queue-drain.start"
  ]);

  await handle.stop();
  assert.deepEqual(calls, [
    "project-ccbd.recover",
    "anchor-dispatch.worker.start",
    "slot-stale-detector.start",
    "slot-queue-drain.start",
    "anchor-dispatch.worker.stop",
    "slot-stale-detector.stop",
    "slot-queue-drain.stop"
  ]);
});

test("projection service stop waits for slot queue drain shutdown", async () => {
  const slotQueueDrainStop = deferred();
  let stopResolved = false;

  const handle = await startProjectionServices({
    recoverProjectCcbdsOnStartup: async () => {},
    startAnchorDispatchWorker: () => ({
      stop: async () => {}
    }),
    startSlotStaleDetector: () => ({
      stop: async () => {}
    }),
    startSlotQueueDrain: () => ({
      stop: async () => {
        await slotQueueDrainStop.promise;
      }
    })
  });

  const stopPromise = handle.stop().then(() => {
    stopResolved = true;
  });
  await Promise.resolve();
  assert.equal(stopResolved, false);

  slotQueueDrainStop.resolve();
  await stopPromise;
  assert.equal(stopResolved, true);
});
