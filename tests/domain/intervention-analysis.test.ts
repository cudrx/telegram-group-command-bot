import { describe, expect, test } from "vitest";

import {
  isFreshInterventionDecision,
  shouldConsiderIntervention
} from "../../src/domain/intervention-analysis.js";

describe("intervention-analysis", () => {
  test("does not consider private chats or direct triggers for intervention analysis", () => {
    expect(
      shouldConsiderIntervention({
        chatType: "private",
        directTrigger: "none",
        randomGatePassed: true
      })
    ).toBe(false);
    expect(
      shouldConsiderIntervention({
        chatType: "group",
        directTrigger: "mention",
        randomGatePassed: true
      })
    ).toBe(false);
    expect(
      shouldConsiderIntervention({
        chatType: "supergroup",
        directTrigger: "reply_to_bot",
        randomGatePassed: true
      })
    ).toBe(false);
  });

  test("considers non-direct group messages only after the cheap random gate passes", () => {
    expect(
      shouldConsiderIntervention({
        chatType: "group",
        directTrigger: "none",
        randomGatePassed: false
      })
    ).toBe(false);
    expect(
      shouldConsiderIntervention({
        chatType: "supergroup",
        directTrigger: "none",
        randomGatePassed: true
      })
    ).toBe(true);
  });

  test("treats decisions as fresh only when no newer message is present", () => {
    expect(
      isFreshInterventionDecision({
        analyzedThroughMessageId: 10,
        latestMessageId: 10
      })
    ).toBe(true);
    expect(
      isFreshInterventionDecision({
        analyzedThroughMessageId: 10,
        latestMessageId: 11
      })
    ).toBe(false);
  });
});
