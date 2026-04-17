export type EvaluationRecommendation = "Approve" | "Revise" | "Reject";

export const evaluationCriteria = [
  {
    id: "problemClarity",
    label: "Problem clarity",
    description: "How clearly the proposal defines the problem and its academic value.",
    weight: 0.18,
  },
  {
    id: "technicalFeasibility",
    label: "Technical feasibility",
    description: "Whether the plan, tools, and scope are realistic for the project duration.",
    weight: 0.22,
  },
  {
    id: "methodologyStrength",
    label: "Methodology strength",
    description: "The quality of the research or implementation approach.",
    weight: 0.22,
  },
  {
    id: "innovation",
    label: "Innovation",
    description: "The originality or differentiated value of the proposal.",
    weight: 0.16,
  },
  {
    id: "impact",
    label: "Impact",
    description: "Expected usefulness, relevance, or institutional/community benefit.",
    weight: 0.12,
  },
  {
    id: "documentationReadiness",
    label: "Documentation readiness",
    description: "How complete and review-ready the submission appears today.",
    weight: 0.1,
  },
] as const;

export type EvaluationCriterionId = (typeof evaluationCriteria)[number]["id"];

export type EvaluationScores = Record<EvaluationCriterionId, number>;

export type ProposalEvaluation = {
  criteria: EvaluationScores;
  overallScore: number;
  recommendation: EvaluationRecommendation;
  strengths: string;
  risks: string;
  summary: string;
  evaluatorName: string;
  evaluatedAt: string;
};

export function createEmptyScores(): EvaluationScores {
  return evaluationCriteria.reduce((accumulator, criterion) => {
    accumulator[criterion.id] = 5;
    return accumulator;
  }, {} as EvaluationScores);
}

export function calculateOverallScore(criteria: EvaluationScores) {
  const weighted = evaluationCriteria.reduce(
    (sum, criterion) => sum + criteria[criterion.id] * criterion.weight,
    0,
  );
  return Number(weighted.toFixed(1));
}

export function recommendationToStatus(recommendation: EvaluationRecommendation) {
  if (recommendation === "Approve") return "Approved";
  if (recommendation === "Reject") return "Rejected";
  return "Revision Requested";
}
