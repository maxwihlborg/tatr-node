local cli = require "tatr.cli"

local M = {}

---@class TatrConfig
---@field cmd string[] how to invoke the cli
---@field args string[] extra args for every `tatr ls`, e.g. { "--fzf" }
---@field order string[] how to order the list, e.g. { "-prio", "title" }, empty leaves it to the cli
---@field cd "lcd"|"tcd"|"cd"|false which cd to run into the task dir before opening
---@field open "edit"|"split"|"vsplit"|"tabedit" how to open the task
---@field create string how to open a task just created by TatrNew
---@field upsert string how TatrUpsert opens the task under the cursor
---@field markers table<string, string[]> comment marker -> tags TatrTodo gives the task
---@field prompt string picker prompt
---@field picker "auto"|"select" which ui to pick with, auto prefers fzf-lua
---@field fzf { keys: table<string, string>, copy: string|false, close: string|false, cycle: string|false, status: string, opts: table, query_delay: number } see tatr.fzf
M.config = {
  cmd = { "tatr" },
  args = {},
  order = {},
  cd = "lcd",
  open = "edit",
  create = "tabe",
  upsert = "tabe",
  markers = {
    TODO = {},
    FIXME = { "bug" },
  },
  picker = "auto",
  prompt = "Tasks> ",
  fzf = {
    -- key -> how to open the task under the cursor, `enter` uses `open` above
    keys = {
      ["ctrl-t"] = "tabedit",
      ["ctrl-v"] = "vsplit",
      ["ctrl-s"] = "split",
    },
    -- key that yanks the id of the task under the cursor, false to disable
    copy = "ctrl-y",
    -- key that closes the task under the cursor, false to disable. ctrl-x is
    -- what fzf-lua's own pickers use for the destructive action in a list
    close = "ctrl-x",
    -- key that cycles open -> closed -> all, false to disable. ctrl-g is what
    -- fzf-lua's own pickers use for switching what they list
    cycle = "ctrl-g",
    -- which tasks the picker starts on, cycled by `cycle`
    status = "open",
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

--- Create a task and open it with `create`.
---@param opts TatrConfig|{ title: string[] }|nil
function M.new(opts)
  local cfg = M.resolve(opts)

  cli.new({ cmd = cfg.cmd, title = (opts or {}).title or {} }, function(file, err)
    if not file then
      return M.fail(err)
    end

    M.open({ file = file }, vim.tbl_deep_extend("force", cfg, { open = cfg.create }))
  end)
end

--- Mint an id and insert `[<id>]: ` at the cursor.
---@param opts TatrConfig?
function M.mint(opts)
  local cfg = M.resolve(opts)
  local win = vim.api.nvim_get_current_win()
  local buf = vim.api.nvim_win_get_buf(win)
  local row, col = unpack(vim.api.nvim_win_get_cursor(win))

  cli.mint({ cmd = cfg.cmd }, function(id, err)
    if not id then
      return M.fail(err)
    end

    local text = ("[%s]: "):format(id)

    vim.api.nvim_buf_set_text(buf, row - 1, col, row - 1, col, { text })

    if vim.api.nvim_get_current_win() == win then
      vim.api.nvim_win_set_cursor(win, { row, col + #text })
    end
  end)
end

--- The id an upsert works from, as `[<id>]: title` from TatrMint or
--- `FIXME(<id>): title` from TatrTodo. The title is optional.
---@param line string
---@return string? id, string title
local function parse_line(line)
  local id, title = line:match "%[([%w]+)%]:?%s*(.*)$"

  if not id then
    id, title = line:match "%(([%w]+)%):?%s*(.*)$"
  end

  return id, vim.trim(title or "")
end

--- Open the task a line's `[<id>]` refers to, creating it first if it is not
--- there yet. Text after the colon becomes the title, otherwise it is asked
--- for.
---@param opts TatrConfig|{ line: string }|nil
function M.upsert(opts)
  local cfg = M.resolve(opts)
  local id, title = parse_line((opts or {}).line or vim.api.nvim_get_current_line())

  if not id then
    return M.fail "No [id] on this line"
  end

  local open = vim.tbl_deep_extend("force", cfg, { open = cfg.upsert })

  local function create(words)
    cli.new({ cmd = cfg.cmd, id = id, title = words }, function(file, err)
      if not file then
        return M.fail(err)
      end

      M.open({ file = file }, open)
    end)
  end

  cli.path({ cmd = cfg.cmd, id = id }, function(file)
    -- no path means no task yet, and `new` reports anything else that is wrong
    if file then
      return M.open({ file = file }, open)
    end

    if title ~= "" then
      return create { title }
    end

    vim.ui.input({ prompt = ("Title for %s: "):format(id) }, function(input)
      if input and vim.trim(input) ~= "" then
        create { input }
      end
    end)
  end)
end

--- The earliest configured marker on the line, e.g. `TODO:`.
---@param line string
---@param markers table<string, string[]>
---@return { from: integer, to: integer, word: string, tags: string[] }?
local function find_marker(line, markers)
  local found

  for word, tags in pairs(markers) do
    local from, to = line:find(word .. ":", 1, true)
    if from and (not found or from < found.from) then
      found = { from = from, to = to, word = word, tags = tags }
    end
  end

  return found
end

--- Turn a `TODO:`/`FIXME:` line into a task: the text after the marker becomes
--- the title, the marker keeps its word and gains the id, and nothing is
--- opened.
---@param opts TatrConfig?
function M.todo(opts)
  local cfg = M.resolve(opts)
  local win = vim.api.nvim_get_current_win()
  local buf = vim.api.nvim_win_get_buf(win)
  local row = vim.api.nvim_win_get_cursor(win)[1]
  local line = vim.api.nvim_get_current_line()

  local marker = find_marker(line, cfg.markers)
  if not marker then
    return M.fail(("No %s on this line"):format(table.concat(vim.tbl_keys(cfg.markers), "/")))
  end

  local rest = line:sub(marker.to + 1)

  local function claim(title)
    cli.new({ cmd = cfg.cmd, title = { title }, tags = marker.tags }, function(file, err)
      if not file then
        return M.fail(err)
      end

      local id = vim.fn.fnamemodify(file, ":t:r")
      local current = vim.api.nvim_buf_get_lines(buf, row - 1, row, false)[1]

      if current ~= line then
        return M.fail(("Created %s, but line %d changed under it"):format(id, row))
      end

      vim.api.nvim_buf_set_lines(buf, row - 1, row, false, {
        ("%s%s(%s):%s"):format(line:sub(1, marker.from - 1), marker.word, id, rest),
      })

      vim.notify(("Created %s"):format(id), vim.log.levels.INFO, { title = "tatr" })
    end)
  end

  if vim.trim(rest) ~= "" then
    return claim(vim.trim(rest))
  end

  vim.ui.input({ prompt = "Task title: " }, function(input)
    if input and vim.trim(input) ~= "" then
      claim(vim.trim(input))
    end
  end)
end

--- List the tasks, `opts.query` is appended to the configured `args`.
---@param opts TatrConfig|{ query: string[] }|nil
---@param cb fun(tasks: TatrTask[], cfg: TatrConfig)
function M.tasks(opts, cb)
  local cfg = M.resolve(opts)
  -- `args` last of the two, so an --order in there wins over the option
  local args = vim.list_extend(cli.order(cfg.order), cfg.args)
  vim.list_extend(args, (opts or {}).query or {})

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
  -- fzf-lua is the better picker when it is installed, and asking for it here
  -- rather than in setup() leaves it lazy until someone picks a task
  if M.resolve(opts).picker ~= "select" and pcall(require, "fzf-lua") then
    return require("tatr.fzf").pick(opts)
  end

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
