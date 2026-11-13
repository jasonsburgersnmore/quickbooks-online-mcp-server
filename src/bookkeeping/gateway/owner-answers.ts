import type { OwnerAnswer } from './types.js';
import { appendGatewayAudit } from './audit-log-file.js';
import { GatewayPaths, loadOwnerAnswers, saveOwnerAnswers } from './store.js';

export function recordOwnerAnswer(
  paths: GatewayPaths,
  questionId: string,
  answer: string,
): OwnerAnswer {
  const answers = loadOwnerAnswers(paths.ownerAnswersPath);
  const entry: OwnerAnswer = {
    questionId,
    answer,
    recordedAt: new Date().toISOString(),
  };
  const next = [...answers.filter((a) => a.questionId !== questionId), entry];
  saveOwnerAnswers(paths.ownerAnswersPath, next);
  appendGatewayAudit(paths.auditLogPath, {
    action: 'record_owner_answer',
    summary: `Recorded owner answer for ${questionId}`,
    details: { questionId, answerLength: answer.length },
  });
  return entry;
}
