import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../lib/query-client";
import {
  adminService,
  type AdminRevenueSummary,
} from "../services/admin.service";

export function useAdminRevenueSummary() {
  return useQuery<AdminRevenueSummary>({
    queryKey: queryKeys.admin.revenue(),
    queryFn: () => adminService.getRevenueSummary(),
    staleTime: 60_000,
  });
}
