/**
 * Bansos administrator hooks.
 *
 * Every response is asserted at the boundary rather than cast. A program whose
 * `maxKeysPerParticipant` arrived as `null` because the server changed would
 * otherwise reach the enforcement display as a number and render "at most
 * null keys"; the guard turns that into a visible error instead.
 */
import { consoleRequest, isRecord } from "../data/api";
import type { ApiErrorShape } from "../data/api";
import type {
  BansosAuditEvent,
  BansosIssuedKey,
  BansosKey,
  BansosKeyInput,
  BansosModel,
  BansosModelInput,
  BansosParticipant,
  BansosParticipantInput,
  BansosProgram,
  BansosProgramInput,
  BansosProgramUsage,
} from "../data/bansos-contracts";
import { queryKeys } from "../data/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function invalidResponse(message: string): ApiErrorShape {
  return { status: 500, code: "invalid_response", message };
}

function assertProgram(value: unknown): BansosProgram {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    throw invalidResponse("Invalid program response");
  }
  if (typeof value.maxKeysPerParticipant !== "number") {
    throw invalidResponse("Program response is missing maxKeysPerParticipant");
  }
  return value as unknown as BansosProgram;
}

function assertPrograms(value: unknown): BansosProgram[] {
  if (!isRecord(value) || !Array.isArray(value.programs)) {
    throw invalidResponse("Invalid program list response");
  }
  return value.programs.map(assertProgram);
}

/**
 * The detail route wraps its row in an envelope — `{ program, counts }` — so
 * the row is unwrapped here rather than at every call site. Reading it as a
 * bare program is what produced "Invalid program response" in the console.
 */
function assertProgramDetail(value: unknown): BansosProgram {
  if (!isRecord(value) || !isRecord(value.program)) {
    throw invalidResponse("Invalid program detail response");
  }
  return assertProgram(value.program);
}

function assertParticipant(value: unknown): BansosParticipant {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") {
    throw invalidResponse("Invalid participant response");
  }
  return value as unknown as BansosParticipant;
}

function assertParticipants(value: unknown): BansosParticipant[] {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw invalidResponse("Invalid participant list response");
  }
  return value.participants.map(assertParticipant);
}

function assertModels(value: unknown): BansosModel[] {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw invalidResponse("Invalid model list response");
  }
  return value.models as BansosModel[];
}

function assertKeys(value: unknown): BansosKey[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw invalidResponse("Invalid key list response");
  }
  return value.keys as BansosKey[];
}

function assertIssuedKey(value: unknown): BansosIssuedKey {
  if (!isRecord(value) || typeof value.secret !== "string" || typeof value.id !== "string") {
    throw invalidResponse("Key issue response carried no secret");
  }
  return value as unknown as BansosIssuedKey;
}

function assertUsage(value: unknown): BansosProgramUsage {
  if (!isRecord(value) || !Array.isArray(value.usage) || !isRecord(value.totals)) {
    throw invalidResponse("Invalid usage response");
  }
  return value as unknown as BansosProgramUsage;
}

function assertAudit(value: unknown): BansosAuditEvent[] {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw invalidResponse("Invalid audit response");
  }
  return value.events as BansosAuditEvent[];
}

/* ── Queries ─────────────────────────────────────────────────────────────── */

export function useBansosPrograms() {
  return useQuery<BansosProgram[], ApiErrorShape>({
    queryKey: queryKeys.bansos.programs,
    queryFn: async ({ signal }) =>
      assertPrograms(
        await consoleRequest<unknown>("/bansos/programs", { method: "GET", signal }),
      ),
  });
}

export function useBansosProgram(programId: string | undefined) {
  return useQuery<BansosProgram, ApiErrorShape>({
    queryKey: queryKeys.bansos.program(programId ?? ""),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async ({ signal }) =>
      assertProgramDetail(
        await consoleRequest<unknown>(`/bansos/programs/${encodeURIComponent(programId ?? "")}`, {
          method: "GET",
          signal,
        }),
      ),
  });
}

export function useBansosParticipants(programId: string | undefined) {
  return useQuery<BansosParticipant[], ApiErrorShape>({
    queryKey: queryKeys.bansos.participants(programId ?? ""),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async ({ signal }) =>
      assertParticipants(
        await consoleRequest<unknown>(
          `/bansos/programs/${encodeURIComponent(programId ?? "")}/participants`,
          { method: "GET", signal },
        ),
      ),
  });
}

export function useBansosModels(programId: string | undefined) {
  return useQuery<BansosModel[], ApiErrorShape>({
    queryKey: queryKeys.bansos.models(programId ?? ""),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async ({ signal }) =>
      assertModels(
        await consoleRequest<unknown>(
          `/bansos/programs/${encodeURIComponent(programId ?? "")}/models`,
          { method: "GET", signal },
        ),
      ),
  });
}

export function useBansosParticipantKeys(participantId: string | undefined) {
  return useQuery<BansosKey[], ApiErrorShape>({
    queryKey: queryKeys.bansos.keys(participantId ?? ""),
    enabled: participantId !== undefined && participantId.length > 0,
    queryFn: async ({ signal }) =>
      assertKeys(
        await consoleRequest<unknown>(
          `/bansos/participants/${encodeURIComponent(participantId ?? "")}/keys`,
          { method: "GET", signal },
        ),
      ),
  });
}

export function useBansosUsage(programId: string | undefined) {
  return useQuery<BansosProgramUsage, ApiErrorShape>({
    queryKey: queryKeys.bansos.usage(programId ?? ""),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async ({ signal }) =>
      assertUsage(
        await consoleRequest<unknown>(
          `/bansos/programs/${encodeURIComponent(programId ?? "")}/usage`,
          { method: "GET", signal },
        ),
      ),
  });
}

export function useBansosAudit(programId: string | undefined) {
  return useQuery<BansosAuditEvent[], ApiErrorShape>({
    queryKey: queryKeys.bansos.audit(programId ?? ""),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async ({ signal }) =>
      assertAudit(
        await consoleRequest<unknown>(
          `/bansos/programs/${encodeURIComponent(programId ?? "")}/audit`,
          { method: "GET", signal },
        ),
      ),
  });
}

/* ── Mutations ───────────────────────────────────────────────────────────── */

export function useCreateBansosProgram() {
  const queryClient = useQueryClient();
  return useMutation<BansosProgram, ApiErrorShape, BansosProgramInput>({
    mutationFn: async (input) =>
      assertProgram(
        await consoleRequest<unknown>("/bansos/programs", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bansos.programs });
    },
  });
}

export function useCreateBansosParticipant() {
  const queryClient = useQueryClient();
  return useMutation<
    BansosParticipant,
    ApiErrorShape,
    { programId: string; input: BansosParticipantInput }
  >({
    mutationFn: async ({ programId, input }) =>
      assertParticipant(
        await consoleRequest<unknown>(
          `/bansos/programs/${encodeURIComponent(programId)}/participants`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.participants(variables.programId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.usage(variables.programId),
      });
    },
  });
}

export function useUpdateBansosProgram() {
  const queryClient = useQueryClient();
  return useMutation<
    BansosProgram,
    ApiErrorShape,
    { programId: string; input: Partial<BansosProgramInput> }
  >({
    mutationFn: async ({ programId, input }) =>
      assertProgram(
        await consoleRequest<unknown>(`/bansos/programs/${encodeURIComponent(programId)}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bansos.programs });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.program(variables.programId),
      });
    },
  });
}

export function useDeleteBansosProgram() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, ApiErrorShape, string>({
    mutationFn: async (programId) =>
      await consoleRequest<{ success: boolean }>(
        `/bansos/programs/${encodeURIComponent(programId)}`,
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bansos.programs });
    },
  });
}

export function useUpdateBansosParticipant() {
  const queryClient = useQueryClient();
  return useMutation<
    BansosParticipant,
    ApiErrorShape,
    { participantId: string; programId: string; input: Partial<BansosParticipantInput> }
  >({
    mutationFn: async ({ participantId, input }) =>
      assertParticipant(
        await consoleRequest<unknown>(
          `/bansos/participants/${encodeURIComponent(participantId)}`,
          { method: "PATCH", body: JSON.stringify(input) },
        ),
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.participants(variables.programId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.usage(variables.programId),
      });
    },
  });
}

export function useAddBansosModel() {
  const queryClient = useQueryClient();
  return useMutation<BansosModel, ApiErrorShape, { programId: string; input: BansosModelInput }>({
    mutationFn: async ({ programId, input }) =>
      await consoleRequest<BansosModel>(
        `/bansos/programs/${encodeURIComponent(programId)}/models`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.models(variables.programId),
      });
    },
  });
}

export function useUpdateBansosModel() {
  const queryClient = useQueryClient();
  return useMutation<
    BansosModel,
    ApiErrorShape,
    { programId: string; modelId: string; input: Partial<BansosModelInput> }
  >({
    mutationFn: async ({ programId, modelId, input }) =>
      await consoleRequest<BansosModel>(
        `/bansos/programs/${encodeURIComponent(programId)}/models/${encodeURIComponent(modelId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.models(variables.programId),
      });
    },
  });
}

export function useRemoveBansosModel() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, ApiErrorShape, { programId: string; modelId: string }>({
    mutationFn: async ({ programId, modelId }) =>
      await consoleRequest<{ success: boolean }>(
        `/bansos/programs/${encodeURIComponent(programId)}/models/${encodeURIComponent(modelId)}`,
        { method: "DELETE" },
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.models(variables.programId),
      });
    },
  });
}

export function useDeleteBansosParticipant() {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean; keysDestroyed: number },
    ApiErrorShape,
    { participantId: string; programId: string }
  >({
    mutationFn: async ({ participantId }) =>
      await consoleRequest<{ success: boolean; keysDestroyed: number }>(
        `/bansos/participants/${encodeURIComponent(participantId)}`,
        { method: "DELETE" },
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.participants(variables.programId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.usage(variables.programId),
      });
    },
  });
}

export function useIssueBansosKey() {
  const queryClient = useQueryClient();
  return useMutation<
    BansosIssuedKey,
    ApiErrorShape,
    { participantId: string; programId: string; input: BansosKeyInput }
  >({
    mutationFn: async ({ participantId, input }) =>
      assertIssuedKey(
        await consoleRequest<unknown>(
          `/bansos/participants/${encodeURIComponent(participantId)}/keys`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.keys(variables.participantId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.usage(variables.programId),
      });
    },
  });
}

export function useRevokeBansosKey() {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean },
    ApiErrorShape,
    { keyId: string; participantId: string; programId: string }
  >({
    mutationFn: async ({ keyId }) =>
      await consoleRequest<{ success: boolean }>(
        `/bansos/keys/${encodeURIComponent(keyId)}/revoke`,
        { method: "POST" },
      ),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.keys(variables.participantId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bansos.usage(variables.programId),
      });
    },
  });
}

