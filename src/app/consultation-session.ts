import {
  emptyClinicalHistory,
  type ClinicalHistory,
} from "../domain/clinical-history/schema";

export type ClinicalExtractionPayload = {
  current_slots: ClinicalHistory;
  latest_final_transcript: string;
  accumulated_transcript: string;
};

export class ConsultationSession {
  clinicalHistory: ClinicalHistory = { ...emptyClinicalHistory };
  finalTranscriptLog: string[] = [];

  reset(): void {
    this.clinicalHistory = { ...emptyClinicalHistory };
    this.finalTranscriptLog = [];
  }

  addFinalTranscript(transcript: string): void {
    this.finalTranscriptLog.push(transcript);
  }

  createExtractionPayload(
    latestFinalTranscript: string
  ): ClinicalExtractionPayload {
    return {
      current_slots: this.clinicalHistory,
      latest_final_transcript: latestFinalTranscript,
      accumulated_transcript: this.finalTranscriptLog.join("\n"),
    };
  }
}
