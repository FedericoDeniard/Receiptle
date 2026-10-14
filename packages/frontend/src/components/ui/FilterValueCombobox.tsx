import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { m, AnimatePresence } from "motion/react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type FilterType,
  type FilterOption,
  getFilterTypeName,
} from "./filters-types";
import { FilterIcon } from "./FilterIcon";
import { AnimateChangeInHeight } from "./AnimateChangeInHeight";

export function FilterValueCombobox({
  filterType,
  options,
  filterValues,
  setFilterValues,
}: {
  filterType: FilterType;
  options: FilterOption[];
  filterValues: string[];
  setFilterValues: (filterValues: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);
  const filterValueSet = useMemo(() => new Set(filterValues), [filterValues]);
  const nonSelectedFilterValues = options.filter(
    filter => !filterValueSet.has(filter.name)
  );

  return (
    <Popover
      open={open}
      onOpenChange={open => {
        setOpen(open);
        if (!open) {
          setTimeout(() => {
            setCommandInput("");
          }, 200);
        }
      }}
    >
      <PopoverTrigger className="border-l border-[var(--text-secondary)]/20 px-2 h-full bg-[var(--bg-secondary)] hover:bg-[var(--text-secondary)]/10 transition text-[var(--text-primary)] shrink-0 min-w-[50px] text-left flex items-center">
        <div className="flex gap-1.5 items-center">
          <div className="flex items-center flex-row gap-x-[-0.375rem]">
            <AnimatePresence mode="popLayout">
              {filterValues?.slice(0, 3).map(value => (
                <m.div
                  key={value}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <FilterIcon
                    type={value as string}
                    className="bg-[var(--bg-secondary)] rounded-full"
                  />
                </m.div>
              ))}
            </AnimatePresence>
          </div>
          {filterValues?.length === 1
            ? options.find(o => o.name === filterValues[0])?.label ||
              filterValues[0]
            : filterValues?.length > 1
              ? t("filters.nSelected", { count: filterValues.length })
              : t("filters.select")}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder={getFilterTypeName(filterType, t)}
              className="h-9"
              value={commandInput}
              onInputCapture={e => {
                setCommandInput(e.currentTarget.value);
              }}
              ref={commandInputRef}
            />
            <CommandList>
              <CommandEmpty>{t("errors.noData", "Sin datos")}</CommandEmpty>
              <CommandGroup>
                {filterValues.map(value => (
                  <CommandItem
                    key={value}
                    className="group flex gap-2 items-center"
                    onSelect={() => {
                      setFilterValues(filterValues.filter(v => v !== value));
                      setTimeout(() => {
                        setCommandInput("");
                      }, 200);
                      setOpen(false);
                    }}
                  >
                    <Checkbox checked={true} />
                    {options.find(o => o.name === value)?.icon || (
                      <FilterIcon type={value} />
                    )}
                    {options.find(o => o.name === value)?.label || value}
                  </CommandItem>
                ))}
              </CommandGroup>
              {nonSelectedFilterValues?.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    {nonSelectedFilterValues.map((filter: FilterOption) => (
                      <CommandItem
                        className="group flex gap-2 items-center"
                        key={filter.name}
                        value={filter.name}
                        onSelect={(currentValue: string) => {
                          setFilterValues([currentValue]);
                          setTimeout(() => {
                            setCommandInput("");
                          }, 200);
                          setOpen(false);
                        }}
                      >
                        <Checkbox
                          checked={false}
                          className="opacity-0 group-data-[selected=true]:opacity-100"
                        />
                        {filter.icon || <FilterIcon type={filter.name} />}
                        <span className="text-[var(--text-primary)]">
                          {filter.label || filter.name}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  );
}
