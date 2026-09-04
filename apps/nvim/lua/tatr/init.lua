local cli = require "tatr.cli"

local M = {}

---@class TatrConfig
---@field cmd string[] how to invoke the cli
---@field args string[] extra args for every `tatr ls`, e.g. { "--order=title" }
---@field cd "lcd"|"tcd"|"cd"|false which cd to run into the task dir before opening
---@field open "edit"|"split"|"vsplit"|"tabedit" how to open the task
---@field prompt string picker prompt
---@field fzf { keys: table<string, string>, opts: table, query_delay: number } see tatr.fzf
M.config = {
  cmd = { "tatr" },
  args = {},
  cd = "lcd",
  open = "edit",
  prompt = "Tasks> ",
  fzf = {
    -- key -> how to open the task under the cursor, `enter` uses `open` above
    keys = {
      ["ctrl-t"] = "tabedit",
      ["ctrl-v"] = "vsplit",
      ["ctrl-s"] = "split",
    },
    -- ms fzf waits before reloading, so a burst of keystrokes costs one run
    query_delay = 150,
    -- passed through to fzf_exec, e.g. { winopts = { preview = { hidden = true } } }
    opts = {},
  },
}

---@param opts TatrConfig?
function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})

  -- only if fzf-lua is already around, loading it from here would defeat
  -- whatever lazy loading the user set up
  if package.loaded["fzf-lua"] then
    require("tatr.fzf").register()
  end
end

---@param opts table?
---@return TatrConfig
function M.resolve(opts)
  return vim.tbl_deep_extend("force", M.config, opts or {})
end

---@param err string
function M.fail(err)
  vim.notify(err, vim.log.levels.ERROR, { title = "tatr" })
end

--- The same layout `tatr ls` prints, minus the colours.
---@param task TatrTask
---@return string
function M.format_item(task)
  local tags = #task.info.tags > 0 and (", tags: %s"):format(table.concat(task.info.tags, ", ")) or ""

  return ("%s: [priority: %d%s] %s"):format(task.id, task.info.priority, tags, task.info.title)
end

--- Open the file, then cd the window it landed in into the task dir.
---@param file string
---@param cfg TatrConfig
local function edit(file, cfg)
  vim.cmd[cfg.open] { args = { vim.fn.fnameescape(file) } }

  if not cfg.cd then
    return
  end

  local win = vim.api.nvim_get_current_win()

  cli.root({ cmd = cfg.cmd }, function(root, err)
    if not root then
      -- the cd is a convenience, the task opened either way
      return M.fail(err)
    end

    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_call(win, function()
        vim.cmd[cfg.cd] { args = { vim.fn.fnameescape(root) } }
      end)
    end
  end)
end

--- Open a task, cd'ing into the task dir first unless that is turned off. A
--- task known only by its id is resolved through the cli.
---@param task TatrTask|{ id: string }
---@param opts TatrConfig?
function M.open(task, opts)
  local cfg = M.resolve(opts)

  if task.file then
    return edit(task.file, cfg)
  end

  cli.path({ cmd = cfg.cmd, id = task.id }, function(file, err)
    if not file then
      return M.fail(err)
    end

    edit(file, cfg)
  end)
end

--- List the tasks, `opts.query` is appended to the configured `args`.
---@param opts TatrConfig|{ query: string[] }|nil
---@param cb fun(tasks: TatrTask[], cfg: TatrConfig)
function M.tasks(opts, cb)
  local cfg = M.resolve(opts)
  local args = vim.list_extend(vim.deepcopy(cfg.args), (opts or {}).query or {})

  cli.list({ cmd = cfg.cmd, args = args }, function(tasks, err)
    if not tasks then
      return M.fail(err)
    end
    if #tasks == 0 then
      return vim.notify("No tasks", vim.log.levels.WARN, { title = "tatr" })
    end

    cb(tasks, cfg)
  end)
end

--- Pick a task with vim.ui.select and open it.
---@param opts TatrConfig|{ query: string[] }|nil
function M.pick(opts)
  M.tasks(opts, function(tasks, cfg)
    vim.ui.select(tasks, {
      prompt = cfg.prompt,
      kind = "tatr",
      format_item = M.format_item,
    }, function(choice)
      if choice then
        M.open(choice, cfg)
      end
    end)
  end)
end

return M
