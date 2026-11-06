import { TUTOR_CONSULTATION_DESCRIPTION, TUTOR_CONSULTATION_PARAMETERS, tutorConsultationAdvice } from "../../../../shared/tutor-consultation";
import { tutorConsultationClient, type TutorConsultationClient } from "../../notorganic-provider/tutor";
import { createTool } from "./shared";

export function createTutorConsultationTools(client: Pick<TutorConsultationClient, "available" | "consult"> | null = tutorConsultationClient()) {
  if (!client?.available()) return [];
  return [createTool("consult_tutor", TUTOR_CONSULTATION_DESCRIPTION, TUTOR_CONSULTATION_PARAMETERS,
    async (params, signal) => tutorConsultationAdvice(await client.consult(params, signal)), ["question"])];
}
