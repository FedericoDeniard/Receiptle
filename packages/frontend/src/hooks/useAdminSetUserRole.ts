import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminService, type AppRole } from "../services/admin.service";
import { queryKeys } from "../lib/query-client";

export interface SetUserRoleInput {
  userId: string;
  role: AppRole;
}

export function useAdminSetUserRole() {
  const qc = useQueryClient();
  return useMutation<void, Error, SetUserRoleInput>({
    mutationFn: ({ userId, role }) => adminService.setUserRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.all });
    },
  });
}
