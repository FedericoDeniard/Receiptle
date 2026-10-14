"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

const Command: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive>>;
  }
> = ({ ref, className, ...props }) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-[var(--bg-primary)] text-[var(--text-primary)]",
      className
    )}
    {...props}
  />
);

const CommandInput: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.Input>>;
  }
> = ({ ref, className, ...props }) => (
  <div
    className="flex items-center border-b px-3 border-[var(--text-secondary)]/20"
    data-cmdk-input-wrapper=""
  >
    <Search className="mr-2 size-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  </div>
);

const CommandList: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.List>>;
  }
> = ({ ref, className, ...props }) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
);

const CommandEmpty: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.Empty>>;
  }
> = ({ ref, ...props }) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
);

const CommandGroup: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.Group>>;
  }
> = ({ ref, className, ...props }) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-[var(--text-primary)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[var(--text-secondary)]",
      className
    )}
    {...props}
  />
);

const CommandSeparator: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.Separator>>;
  }
> = ({ ref, className, ...props }) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-[var(--text-secondary)]/20", className)}
    {...props}
  />
);

const CommandItem: React.FC<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> & {
    ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.Item>>;
  }
> = ({ ref, className, ...props }) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-[var(--bg-secondary)] data-[selected=true]:text-[var(--text-primary)] data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
);

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
};
