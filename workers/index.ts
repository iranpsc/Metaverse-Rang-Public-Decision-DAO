/**
 * ============================================================================
 * MetaRang Public Decision DAO — Core Edge Consensus & Had-e-Tasar Engine v2.0
 * Repository: iranpsc/Metaverse-Rang-Public-Decision-DAO
 * Architecture: Cloudflare Workers + Durable Objects (SQLite/Alarms) + Workers AI
 * ============================================================================
 */

export interface Env {
  IMPACT_ENGINE_DO: DurableObjectNamespace;
  AI: any;
  GITHUB_OWNER: string;
  GITHUB_DAO_REPO: string;
  GITHUB_DISPATCH_TOKEN: string; // Secret: Fine-grained PAT for triggering GitHub Actions
  METARANG_SSO_SECRET: string;   // Secret: HMAC/JWT verification key for SSO & Wallet
  TELEGRAM_BOT_TOKEN?: string;
  BALE_BOT_TOKEN?: string;
}

// ============================================================================
// 1. 13-Tier Governance Hierarchy & Law of Progression Configuration
// ============================================================================
export interface RoleTierConfig {
  level: number;
  titleFa: string;
  titleEn: string;
  intrinsicCapacity: number;
  quorum: number;
  durationHours: number;
  allowedDomains: string[];
}

export const GOVERNANCE_TIERS: Record<number, RoleTierConfig> = {
  1:  { level: 1,  titleFa: "شهروند",       titleEn: "Citizen",      intrinsicCapacity: 1,     quorum: 100,     durationHours: 24,  allowedDomains: ["community", "micro-participation", "general-ui"] },
  2:  { level: 2,  titleFa: "خبرنگار",      titleEn: "Reporter",     intrinsicCapacity: 3,     quorum: 300,     durationHours: 36,  allowedDomains: ["media", "news", "notifications", "reporting"] },
  3:  { level: 3,  titleFa: "مشارکت‌کننده", titleEn: "Contributor",  intrinsicCapacity: 8,     quorum: 800,     durationHours: 48,  allowedDomains: ["social", "forum", "3d-assets-submission", "events"] },
  4:  { level: 4,  titleFa: "توسعه‌دهنده",  titleEn: "Developer",    intrinsicCapacity: 18,    quorum: 1800,    durationHours: 72,  allowedDomains: ["code", "infrastructure", "microservices", "frontend", "webgl"] },
  5:  { level: 5,  titleFa: "بازرس",        titleEn: "Inspector",    intrinsicCapacity: 36,    quorum: 3600,    durationHours: 96,  allowedDomains: ["audit", "quality-control", "validation", "security-review"] },
  6:  { level: 6,  titleFa: "تاجر",         titleEn: "Merchant",     intrinsicCapacity: 76,    quorum: 7600,    durationHours: 120, allowedDomains: ["commerce", "marketplace", "trade", "pricing"] },
  7:  { level: 7,  titleFa: "دادخواه",      titleEn: "Advocate",     intrinsicCapacity: 166,   quorum: 16600,   durationHours: 144, allowedDomains: ["legal", "citizen-rights", "dispute-mediation", "privacy"] },
  8:  { level: 8,  titleFa: "شورای شهر",    titleEn: "City Council", intrinsicCapacity: 366,   quorum: 36600,   durationHours: 168, allowedDomains: ["local-policy", "urban-planning", "civic-proposals"] },
  9:  { level: 9,  titleFa: "شهردار",       titleEn: "Mayor",        intrinsicCapacity: 796,   quorum: 79600,   durationHours: 192, allowedDomains: ["land-subdivision", "land-consolidation", "municipal-execution"] },
  10: { level: 10, titleFa: "فرماندار",     titleEn: "Governor",     intrinsicCapacity: 1696,  quorum: 169600,  durationHours: 216, allowedDomains: ["regional-governance", "provincial-development", "inter-city"] },
  11: { level: 11, titleFa: "کارگزار",      titleEn: "Commissioner", intrinsicCapacity: 3696,  quorum: 369600,  durationHours: 240, allowedDomains: ["macro-policy", "treasury-loans", "governance-funds"] },
  12: { level: 12, titleFa: "داور",         titleEn: "Arbitrator",   intrinsicCapacity: 7896,  quorum: 789600,  durationHours: 288, allowedDomains: ["judicial-ruling", "structural-disputes", "anti-collusion-verdict"] },
  13: { level: 13, titleFa: "دادگذار",      titleEn: "Legislator",   intrinsicCapacity: 16369, quorum: 1636900, durationHours: 336, allowedDomains: ["foundational-law", "constitutional-charter", "social-structure"] }
};

// ============================================================================
// 2. Data Structures for Citizens, Decisions, and Votes
// ============================================================================
export interface CitizenState {
  citizenId: string;
  walletAddress: string;
  ssoConnected: boolean;
  roleLevel: number;
  intrinsicBalance: number;     // Must equal RoleTierConfig.intrinsicCapacity to create a decision
  leasedBalance: number;        // Rented via PSC Smart Contract (Eligible for voting ONLY)
  isFullyDepleted: boolean;     // Triggers Instant Per-Minute Recharge if true
  lastRechargeTimestamp: number;
  cycleStartTimestamp: number;  // 24-hour cycle tracker for Gradual Recharge
  lastVoteTimestamp: number;    // Enforces 60-second cooldown
  activeCreatedDecisionId: string | null;
  lockedUntilTimestamp: number; // Enforces 24h unlock on win or exponential penalty on loss
  consecutiveFailures: number;
}

export interface VoteRecord {
  citizenId: string;
  roleLevel: number;
  netRawVote: number;           // Aggregated raw impact (+5 then -10 => -5)
  netEffectiveVote: number;     // Aggregated effective impact after progressive burn & decay
  totalBurned: number;
  lastUpdated: number;
  channel: "metarang" | "telegram" | "bale";
  ipHash?: string;
}

export interface DecisionState {
  decisionId: string;
  discussionNumber: number;
  title: string;
  specification: string;
  targetRepository: string;
  creatorCitizenId: string;
  creatorLevel: number;
  targetLevel: number;
  stakedImpact: number;
  createdAt: number;
  expiresAt: number;
  requiredQuorum: number;
  status: "ACTIVE" | "APPROVED" | "REJECTED" | "FLAGGED_COLLUSION";
  effectivePositiveVotes: number;
  effectiveNegativeVotes: number;
  totalBurnedImpact: number;
  collusionRiskScore: number;
  votesByCitizen: Record<string, VoteRecord>; // Aggregated transaction history
  zkpWhistleblowerFlags: number;
}

// ============================================================================
// 3. Mathematical Helper Functions (Law of Progression & Dual Recharge)
// ============================================================================

/**
 * Dual Recharge Engine:
 * - Instant Per-Minute Recharge if 100% of capacity was consumed.
 * - Gradual Proportional Recharge over remaining 24-hour cycle if partially consumed.
 */
export function synchronizeCitizenRecharge(citizen: CitizenState, now: number): CitizenState {
  const tierConfig = GOVERNANCE_TIERS[citizen.roleLevel];
  const maxCapacity = tierConfig.intrinsicCapacity;

  // If creator's stake is locked due to an active decision or post-decision lock penalty, do not unlock yet
  if (citizen.activeCreatedDecisionId !== null || now < citizen.lockedUntilTimestamp) {
    citizen.lastRechargeTimestamp = now;
    return citizen;
  }

  if (citizen.intrinsicBalance >= maxCapacity) {
    citizen.intrinsicBalance = maxCapacity;
    citizen.isFullyDepleted = false;
    citizen.lastRechargeTimestamp = now;
    return citizen;
  }

  const elapsedMs = Math.max(0, now - citizen.lastRechargeTimestamp);

  if (citizen.isFullyDepleted) {
    // Instant Recharge Mode: Starts immediately on a per-minute basis over 24 hours (1440 minutes)
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    if (elapsedMinutes > 0) {
      const rechargePerMinute = maxCapacity / 1440;
      citizen.intrinsicBalance = Math.min(maxCapacity, Number((citizen.intrinsicBalance + elapsedMinutes * rechargePerMinute).toFixed(4)));
      citizen.lastRechargeTimestamp += elapsedMinutes * 60000;
      if (citizen.intrinsicBalance >= maxCapacity) {
        citizen.isFullyDepleted = false;
      }
    }
  } else {
    // Gradual Recharge Mode: Proportional to the remaining time of the 24-hour cycle
    const cycleEnd = citizen.cycleStartTimestamp + 24 * 3600 * 1000;
    if (now >= cycleEnd) {
      citizen.intrinsicBalance = maxCapacity;
      citizen.cycleStartTimestamp = now;
      citizen.lastRechargeTimestamp = now;
    } else {
      const remainingCycleMs = Math.max(1, cycleEnd - citizen.lastRechargeTimestamp);
      const missingCapacity = maxCapacity - citizen.intrinsicBalance;
      const rechargedAmount = missingCapacity * Math.min(1, elapsedMs / remainingCycleMs);
      citizen.intrinsicBalance = Math.min(maxCapacity, Number((citizen.intrinsicBalance + rechargedAmount).toFixed(4)));
      citizen.lastRechargeTimestamp = now;
    }
  }

  return citizen;
}

/**
 * Progressive Burn & Impact Decay when a higher-tier citizen votes on a lower-tier decision
 */
export function computeProgressiveVoteImpact(
  rawAmount: number,
  voterLevel: number,
  decisionTargetLevel: number
): { effectiveVote: number; burnedAmount: number } {
  if (voterLevel <= decisionTargetLevel) {
    return { effectiveVote: rawAmount, burnedAmount: 0 };
  }

  const deltaL = voterLevel - decisionTargetLevel;
  const burnRatio = 1 - Math.pow(0.85, deltaL);
  const burnedAmount = rawAmount * burnRatio;
  const decayDivisor = Math.pow(2, Math.floor(deltaL / 2));
  const effectiveVote = (rawAmount - burnedAmount) / decayDivisor;

  return {
    effectiveVote: Number(effectiveVote.toFixed(4)),
    burnedAmount: Number(burnedAmount.toFixed(4)),
  };
}

/**
 * 3-Layer Anti-Collusion Risk Score Evaluator
 */
export function evaluateCollusionRiskScore(decision: DecisionState): number {
  const votes = Object.values(decision.votesByCitizen);
  if (votes.length === 0) return 0;

  let riskScore = 0;
  const windowDuration = decision.expiresAt - decision.createdAt;
  const lastMinuteThreshold = decision.expiresAt - windowDuration * 0.05; // Last 5% of voting window

  let lastMinuteVolume = 0;
  const ipClusters: Record<string, number> = {};

  for (const v of votes) {
    if (v.lastUpdated >= lastMinuteThreshold) {
      lastMinuteVolume += Math.abs(v.netEffectiveVote);
    }
    if (v.ipHash) {
      ipClusters[v.ipHash] = (ipClusters[v.ipHash] || 0) + 1;
    }
  }

  const totalVolume = decision.effectivePositiveVotes + decision.effectiveNegativeVotes;
  if (totalVolume > 0 && lastMinuteVolume / totalVolume > 0.75) {
    riskScore += 0.45; // Behavioral indicator: Sudden last-minute impact spike
  }

  const maxSameIp = Math.max(0, ...Object.values(ipClusters));
  if (maxSameIp >= 5) {
    riskScore += 0.35; // Network indicator: Potential Sybil cluster
  }

  if (decision.zkpWhistleblowerFlags > 0) {
    riskScore += Math.min(0.4, decision.zkpWhistleblowerFlags * 0.2);
  }

  return Number(Math.min(1.0, riskScore).toFixed(2));
}

// ============================================================================
// 4. Durable Object Class: ImpactEngineDO
// ============================================================================
export class ImpactEngineDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    try {
      // ----------------------------------------------------------------------
      // Endpoint 1: Register New Public Decision (/public-decision/register)
      // ----------------------------------------------------------------------
      if (url.pathname === "/public-decision/register" && request.method === "POST") {
        const payload: any = await request.json();
        const {
          citizenId,
          walletAddress,
          ssoConnected,
          creatorLevel,
          targetLevel,
          discussionNumber,
          title,
          specification,
          targetRepository
        } = payload;

        // Rule 1: Mandatory SSO/Wallet connection
        if (!ssoConnected || !citizenId || !walletAddress) {
          return Response.json({ error: "SSO_WALLET_REQUIRED", message: "Mandatory MetaRang SSO/Wallet authentication is required." }, { status: 403 });
        }

        // Rule 2: Vertical Tier Authority Check
        if (targetLevel > creatorLevel) {
          return Response.json({
            error: "VERTICAL_TIER_VIOLATION",
            message: `Tier ${creatorLevel} cannot create decisions for higher Tier${targetLevel}.`
          }, { status: 403 });
        }

        // Load & synchronize creator state
        let creator = await this.state.storage.get<CitizenState>(`citizen:${citizenId}`);
        const tierConfig = GOVERNANCE_TIERS[creatorLevel];
        if (!creator) {
          creator = {
            citizenId,
            walletAddress,
            ssoConnected: true,
            roleLevel: creatorLevel,
            intrinsicBalance: tierConfig.intrinsicCapacity,
            leasedBalance: 0,
            isFullyDepleted: false,
            lastRechargeTimestamp: now,
            cycleStartTimestamp: now,
            lastVoteTimestamp: 0,
            activeCreatedDecisionId: null,
            lockedUntilTimestamp: 0,
            consecutiveFailures: 0
          };
        } else {
          creator = synchronizeCitizenRecharge(creator, now);
        }

        // Rule 3: Creator cannot have another active decision or active lock penalty
        if (creator.activeCreatedDecisionId !== null || now < creator.lockedUntilTimestamp) {
          return Response.json({
            error: "CREATOR_IMPACT_LOCKED",
            message: "You already have an active decision or lock penalty in progress.",
            lockedUntil: new Date(creator.lockedUntilTimestamp).toISOString()
          }, { status: 409 });
        }

        // Rule 4: Must hold 100% intrinsic capacity unspent and unleased
        if (creator.intrinsicBalance < tierConfig.intrinsicCapacity) {
          return Response.json({
            error: "INSUFFICIENT_INTRINSIC_STAKE",
            message: `100% intrinsic Impact Limit (${tierConfig.intrinsicCapacity} units) is required to create a decision. Current intrinsic balance: ${creator.intrinsicBalance}. Leased impact cannot be used.`
          }, { status: 400 });
        }

        const targetConfig = GOVERNANCE_TIERS[targetLevel];
        const decisionId = `DEC-${new Date(now).getUTCFullYear()}-${String(discussionNumber).padStart(4, "0")}`;
        const expiresAt = now + targetConfig.durationHours * 3600 * 1000;

        // Lock 100% of Creator's Intrinsic Impact Limit
        creator.intrinsicBalance = 0;
        creator.activeCreatedDecisionId = decisionId;
        creator.lockedUntilTimestamp = expiresAt;

        const decision: DecisionState = {
          decisionId,
          discussionNumber,
          title,
          specification,
          targetRepository,
          creatorCitizenId: citizenId,
          creatorLevel,
          targetLevel,
          stakedImpact: tierConfig.intrinsicCapacity,
          createdAt: now,
          expiresAt,
          requiredQuorum: targetConfig.quorum,
          status: "ACTIVE",
          effectivePositiveVotes: 0,
          effectiveNegativeVotes: 0,
          totalBurnedImpact: 0,
          collusionRiskScore: 0,
          votesByCitizen: {},
          zkpWhistleblowerFlags: 0
        };

        await this.state.storage.put(`citizen:${citizenId}`, creator);
        await this.state.storage.put(`decision:${decisionId}`, decision);

        // Schedule Durable Object Alarm for the earliest expiring active decision
        const currentAlarm = await this.state.storage.getAlarm();
        if (!currentAlarm || expiresAt < currentAlarm) {
          await this.state.storage.setAlarm(expiresAt);
        }

        return Response.json({
          status: "REGISTERED_AND_STAKED",
          decisionId,
          stakedImpact: decision.stakedImpact,
          requiredQuorum: decision.requiredQuorum,
          expiresAt: new Date(expiresAt).toISOString()
        });
      }

      // ----------------------------------------------------------------------
      // Endpoint 2: Unified Multi-Channel Voting (/public-decision/vote)
      // ----------------------------------------------------------------------
      if (url.pathname === "/public-decision/vote" && request.method === "POST") {
        const payload: any = await request.json();
        const {
          decisionId,
          citizenId,
          walletAddress,
          ssoConnected,
          voterLevel,
          direction, // "POSITIVE" | "NEGATIVE"
          requestedAmount, // Used only on "metarang" frontend
          channel, // "metarang" | "telegram" | "bale"
          ipHash
        } = payload;

        // Rule 1: Mandatory SSO/Wallet Connection (No unconnected guest voting)
        if (!ssoConnected || !citizenId || !walletAddress) {
          return Response.json({
            error: "SSO_WALLET_REQUIRED",
            message: "Unconnected guest voting is disabled. Please connect your MetaRang SSO or Wallet."
          }, { status: 403 });
        }

        const decision = await this.state.storage.get<DecisionState>(`decision:${decisionId}`);
        if (!decision || decision.status !== "ACTIVE" || now >= decision.expiresAt) {
          return Response.json({ error: "DECISION_CLOSED_OR_NOT_FOUND" }, { status: 400 });
        }

        // Rule 2: Creator is strictly prohibited from voting on their own decision (or any decision while locked)
        if (decision.creatorCitizenId === citizenId) {
          return Response.json({
            error: "CREATOR_VOTING_PROHIBITED",
            message: "The decision creator cannot vote on their own decision."
          }, { status: 403 });
        }

        const tierConfig = GOVERNANCE_TIERS[voterLevel];
        let voter = await this.state.storage.get<CitizenState>(`citizen:${citizenId}`);
        if (!voter) {
          voter = {
            citizenId,
            walletAddress,
            ssoConnected: true,
            roleLevel: voterLevel,
            intrinsicBalance: tierConfig.intrinsicCapacity,
            leasedBalance: 0,
            isFullyDepleted: false,
            lastRechargeTimestamp: now,
            cycleStartTimestamp: now,
            lastVoteTimestamp: 0,
            activeCreatedDecisionId: null,
            lockedUntilTimestamp: 0,
            consecutiveFailures: 0
          };
        } else {
          voter = synchronizeCitizenRecharge(voter, now);
        }

        if (voter.activeCreatedDecisionId !== null) {
          return Response.json({
            error: "CREATOR_LOCK_ACTIVE",
            message: "Your Impact Limit is currently staked in an active decision."
          }, { status: 403 });
        }

        // Rule 3: 60-Second Cooldown Enforcement
        if (now - voter.lastVoteTimestamp < 60 * 1000) {
          const waitSeconds = Math.ceil((60000 - (now - voter.lastVoteTimestamp)) / 1000);
          return Response.json({
            error: "COOLDOWN_ACTIVE",
            message: `Please wait ${waitSeconds} seconds before spending Impact Limit again.`
          }, { status: 429 });
        }

        const totalAvailableBalance = Number((voter.intrinsicBalance + voter.leasedBalance).toFixed(4));

        // Rule 4: Channel-Specific Consumption (100% on Telegram/Bale vs. Custom on MetaRang)
        let rawSpend = 0;
        if (channel === "telegram" || channel === "bale") {
          rawSpend = totalAvailableBalance;
        } else {
          rawSpend = Number(requestedAmount || 0);
        }

        // Rule 5: Minimum 1 Unit Floor
        if (rawSpend < 1 || totalAvailableBalance < 1 || rawSpend > totalAvailableBalance) {
          return Response.json({
            error: "INVALID_IMPACT_AMOUNT",
            message: "Minimum 1 free Impact Limit unit is required to vote.",
            availableBalance: totalAvailableBalance
          }, { status: 400 });
        }

        // Deduct from leased balance first, then intrinsic balance
        let remainingToDeduct = rawSpend;
        if (voter.leasedBalance >= remainingToDeduct) {
          voter.leasedBalance = Number((voter.leasedBalance - remainingToDeduct).toFixed(4));
          remainingToDeduct = 0;
        } else {
          remainingToDeduct -= voter.leasedBalance;
          voter.leasedBalance = 0;
          voter.intrinsicBalance = Number(Math.max(0, voter.intrinsicBalance - remainingToDeduct).toFixed(4));
        }

        // Trigger Dual Recharge state
        if (voter.intrinsicBalance === 0 && voter.leasedBalance === 0) {
          voter.isFullyDepleted = true;
        }
        voter.lastVoteTimestamp = now;
        voter.lastRechargeTimestamp = now;

        // Calculate Progressive Burn & Impact Decay
        const { effectiveVote, burnedAmount } = computeProgressiveVoteImpact(
          rawSpend,
          voterLevel,
          decision.targetLevel
        );

        const signedRaw = direction === "POSITIVE" ? rawSpend : -rawSpend;
        const signedEffective = direction === "POSITIVE" ? effectiveVote : -effectiveVote;

        // Aggregate Transaction History for this Citizen on this Decision
        const existingRecord = decision.votesByCitizen[citizenId] || {
          citizenId,
          roleLevel: voterLevel,
          netRawVote: 0,
          netEffectiveVote: 0,
          totalBurned: 0,
          lastUpdated: now,
          channel
        };

        existingRecord.netRawVote = Number((existingRecord.netRawVote + signedRaw).toFixed(4));
        existingRecord.netEffectiveVote = Number((existingRecord.netEffectiveVote + signedEffective).toFixed(4));
        existingRecord.totalBurned = Number((existingRecord.totalBurned + burnedAmount).toFixed(4));
        existingRecord.lastUpdated = now;
        existingRecord.channel = channel;
        if (ipHash) existingRecord.ipHash = ipHash;

        decision.votesByCitizen[citizenId] = existingRecord;
        decision.totalBurnedImpact = Number((decision.totalBurnedImpact + burnedAmount).toFixed(4));

        if (direction === "POSITIVE") {
          decision.effectivePositiveVotes = Number((decision.effectivePositiveVotes + effectiveVote).toFixed(4));
        } else {
          decision.effectiveNegativeVotes = Number((decision.effectiveNegativeVotes + effectiveVote).toFixed(4));
        }

        await this.state.storage.put(`citizen:${citizenId}`, voter);
        await this.state.storage.put(`decision:${decisionId}`, decision);

        return Response.json({
          status: "VOTE_RECORDED",
          channel,
          notificationMessage: `✅ ${rawSpend} واحد حد تأثیر شما (${direction === "POSITIVE" ? "مثبت" : "منفی"}) با موفقیت ثبت شد. اثر خالص پس از کسر سوخت تصاعدی: ${effectiveVote} واحد.`,
          consumedRawImpact: rawSpend,
          burnedImpact: burnedAmount,
          effectiveImpactApplied: effectiveVote,
          aggregatedCitizenHistoryOnDecision: existingRecord.netEffectiveVote,
          remainingAvailableBalance: Number((voter.intrinsicBalance + voter.leasedBalance).toFixed(4)),
          rechargeMode: voter.isFullyDepleted ? "INSTANT_PER_MINUTE" : "GRADUAL_24H_CYCLE"
        });
      }

      return Response.json({ status: "MetaRang ImpactEngineDO Active" });
    } catch (err: any) {
      return Response.json({ error: "INTERNAL_ENGINE_ERROR", details: err.message }, { status: 500 });
    }
  }

  // --------------------------------------------------------------------------
  // Durable Object Alarm: Automatic Expiration Evaluation & GitHub Callback
  // --------------------------------------------------------------------------
  async alarm(): Promise<void> {
    const now = Date.now();
    const allEntries = await this.state.storage.list<DecisionState>({ prefix: "decision:" });
    let nextEarliestExpiration: number | null = null;

    for (const [key, decision] of allEntries.entries()) {
      if (decision.status !== "ACTIVE") continue;

      if (now >= decision.expiresAt) {
        // 1. Run 3-Layer Anti-Collusion Shield
        decision.collusionRiskScore = evaluateCollusionRiskScore(decision);

        const creatorKey = `citizen:${decision.creatorCitizenId}`;
        const creator = await this.state.storage.get<CitizenState>(creatorKey);

        if (decision.collusionRiskScore >= 0.75) {
          decision.status = "FLAGGED_COLLUSION";
          await this.state.storage.put(key, decision);
          continue;
        }

        // 2. Evaluate Quorum & Single-Unit Margin Rule (Even 1 unit difference decides outcome)
        const totalParticipation = decision.effectivePositiveVotes + decision.effectiveNegativeVotes;
        const quorumMet = totalParticipation >= decision.requiredQuorum;
        const hasPositiveMajority = decision.effectivePositiveVotes > decision.effectiveNegativeVotes;

        if (quorumMet && hasPositiveMajority) {
          decision.status = "APPROVED";
          if (creator) {
            creator.activeCreatedDecisionId = null;
            creator.consecutiveFailures = 0;
            // Approved: Returns to recharge cycle and unlocks after 24 hours
            creator.lockedUntilTimestamp = now + 24 * 3600 * 1000;
            creator.intrinsicBalance = GOVERNANCE_TIERS[creator.roleLevel].intrinsicCapacity;
            await this.state.storage.put(creatorKey, creator);
          }
        } else {
          decision.status = "REJECTED";
          if (creator) {
            creator.activeCreatedDecisionId = null;
            creator.consecutiveFailures += 1;
            // Rejected: Exponential Lock Penalty
            const failureMultiplier = Math.pow(2, creator.consecutiveFailures);
            const negativeRatio = 1 + decision.effectiveNegativeVotes / (decision.effectivePositiveVotes + 1);
            const penaltyHours = Math.ceil(24 * failureMultiplier * negativeRatio);
            creator.lockedUntilTimestamp = now + penaltyHours * 3600 * 1000;
            creator.intrinsicBalance = GOVERNANCE_TIERS[creator.roleLevel].intrinsicCapacity;
            await this.state.storage.put(creatorKey, creator);
          }
        }

        await this.state.storage.put(key, decision);

        // 3. Trigger GitHub Actions Auto-Delegation Workflow via repository_dispatch
        if (this.env.GITHUB_DISPATCH_TOKEN) {
          const netMargin = Number((decision.effectivePositiveVotes - decision.effectiveNegativeVotes).toFixed(4));
          await fetch(`https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_DAO_REPO}/dispatches`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${this.env.GITHUB_DISPATCH_TOKEN}`,
              "Accept": "application/vnd.github+json",
              "User-Agent": "MetaRang-Public-Decision-DAO-Agent"
            },
            body: JSON.stringify({
              event_type: "dao-decision-evaluated",
              client_payload: {
                decision_id: decision.decisionId,
                discussion_number: decision.discussionNumber,
                outcome: decision.status,
                tally: {
                  positive_votes: decision.effectivePositiveVotes,
                  negative_votes: decision.effectiveNegativeVotes,
                  net_margin: netMargin > 0 ? `+${netMargin}` : `${netMargin}`,
                  burned_impact: decision.totalBurnedImpact,
                  collusion_risk_score: decision.collusionRiskScore
                },
                psc_reward_pool: "50_PERCENT_ADVISORS_ANNUAL_ALLOCATION"
              }
            })
          });
        }
      } else {
        if (!nextEarliestExpiration || decision.expiresAt < nextEarliestExpiration) {
          nextEarliestExpiration = decision.expiresAt;
        }
      }
    }

    if (nextEarliestExpiration) {
      await this.state.storage.setAlarm(nextEarliestExpiration);
    }
  }
}

// ============================================================================
// 5. Main Cloudflare Worker Fetch Handler & AI Level Guardrail
// ============================================================================
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Healthcheck & Status Endpoint
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: "MetaRang Public Decision DAO — Edge Consensus Engine v2.0",
        status: "ACTIVE",
        tiersConfigured: 13,
        rewardPool: "50% of PSC Scientific Advisors Annual Release (Exponential Decay)"
      });
    }

    // AI Semantic Level Guardrail check before registering a new decision
    if (url.pathname === "/public-decision/register" && request.method === "POST") {
      const clonedRequest = request.clone();
      const body: any = await clonedRequest.json();
      const creatorLevel = Number(body.creatorLevel || 1);
      const targetLevel = Number(body.targetLevel || 1);

      if (targetLevel > creatorLevel) {
        return Response.json({
          error: "VERTICAL_AUTHORITY_VIOLATION",
          message: `Citizen of Tier ${creatorLevel} cannot create a decision for higher Tier${targetLevel}.`
        }, { status: 403 });
      }

      // Semantic verification via Cloudflare Workers AI (if bound)
      if (env.AI && body.specification) {
        try {
          const allowedDomains = Object.values(GOVERNANCE_TIERS)
            .filter(t => t.level <= creatorLevel)
            .flatMap(t => t.allowedDomains)
            .join(", ");

          const aiPrompt = `You are the MetaRang DAO Governance Guardrail.
Creator Role Tier: ${creatorLevel} (${GOVERNANCE_TIERS[creatorLevel]?.titleEn}).
Allowed Domains for Tier 1 to ${creatorLevel}:${allowedDomains}.
Higher-Tier Restricted Domains: Land subdivision/consolidation (Tier 9 Mayor), Provincial governance (Tier 10 Governor), Treasury loans (Tier 11 Commissioner), Judicial rulings (Tier 12 Arbitrator), Constitutional foundational laws (Tier 13 Legislator).

Proposal Title: ${body.title}
Proposal Specification: ${body.specification}

Does this proposal attempt to enact rules for a domain strictly belonging to a tier higher than Tier ${creatorLevel}? Respond ONLY with JSON: {"allowed": true/false, "requiredTier": number, "reason": "string"}`;

          const aiResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            prompt: aiPrompt
          });

          const parsedMatch = String(aiResult?.response || "").match(/\{[\s\S]*\}/);
          if (parsedMatch) {
            const verdict = JSON.parse(parsedMatch[0]);
            if (verdict.allowed === false && verdict.requiredTier > creatorLevel) {
              return Response.json({
                error: "AI_SEMANTIC_GUARDRAIL_BLOCKED",
                creatorTier: creatorLevel,
                requiredTier: verdict.requiredTier,
                reason: verdict.reason
              }, { status: 403 });
            }
          }
        } catch (aiErr) {
          // Proceed with deterministic tier validation if AI model call times out
        }
      }
    }

    // Route all state-mutating requests to the global singleton Durable Object
    const id = env.IMPACT_ENGINE_DO.idFromName("GLOBAL_METARANG_DAO_V2");
    const stub = env.IMPACT_ENGINE_DO.get(id);
    return stub.fetch(request);
  }
};
