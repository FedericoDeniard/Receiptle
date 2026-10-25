import { beforeEach, describe, expect, mock, test } from "bun:test";

interface RpcResult {
  data: null;
  error: { message: string } | null;
}

const rpc = mock(
  async (
    _name: string,
    _args: Record<string, unknown>
  ): Promise<RpcResult> => ({
    data: null,
    error: null,
  })
);

mock.module("../src/lib/supabase", () => ({
  getSupabase: async () => ({
    schema: () => ({ rpc }),
  }),
}));

const { adminService } = await import("../src/services/admin.service");

const TARGET_USER_ID = "11111111-1111-1111-1111-111111111111";

describe("adminService.setUserRole", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async () => ({ data: null, error: null }));
  });

  test("resolves when the void rpc succeeds with an empty body", async () => {
    await expect(
      adminService.setUserRole(TARGET_USER_ID, "tester")
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_set_user_role", {
      p_user_id: TARGET_USER_ID,
      p_role: "tester",
    });
  });

  test("throws the postgrest message when the rpc fails", async () => {
    rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "forbidden: cannot change your own role" },
    }));

    await expect(
      adminService.setUserRole(TARGET_USER_ID, "admin")
    ).rejects.toThrow("forbidden: cannot change your own role");
  });
});
