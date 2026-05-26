import {
  emptyClinicalHistory,
  type ClinicalHistory,
} from "../domain/clinical-history/schema";

export type DictationTarget = "previous_abnormal_results" | "head_to_toe_exam";

export type ClinicalExtractionPayload = {
  current_slots: ClinicalHistory;
  latest_final_transcript: string;
  accumulated_transcript: string;
};

export class ConsultationSession {
  clinicalHistory: ClinicalHistory = { ...emptyClinicalHistory };
  finalTranscriptLog: string[] = [];
  activeDictationTarget: DictationTarget | null = null;

  reset(): void {
    this.clinicalHistory = { ...emptyClinicalHistory };
    this.finalTranscriptLog = [];
    this.activeDictationTarget = null;
  }

  addFinalTranscript(transcript: string): void {
    this.finalTranscriptLog.push(transcript);
  }

  startDictation(target: DictationTarget): void {
    this.activeDictationTarget = target;
  }

  stopDictation(): void {
    this.activeDictationTarget = null;
  }

  appendDictationText(target: DictationTarget, text: string): void {
    const current = this.clinicalHistory[target];
    this.clinicalHistory[target] = current ? `${current}\n${text}` : text;
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
