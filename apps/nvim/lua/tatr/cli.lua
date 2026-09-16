local Job = require "plenary.job"

local M = {}

---@class TatrTask
---@field id string
---@field file string absolute path
---@field info { title: string, priority: integer, tags: string[] }
---@field stat { mtime: string, atime: string, birthtime: string, size: string }

--- Run tatr and hand the callback its stdout lines, back on the main loop.
--- The job inherits the editor's cwd, so tatr finds the same tatr.config.yaml
--- the user is looking at.
---@param opts { cmd: string[], args: string[] }
---@param cb fun(lines: string[]?, err: string?)
local function run(opts, cb)
  local args = vim.deepcopy(opts.cmd)
  local command = table.remove(args, 1)
  vim.list_extend(args, opts.args)

  local job = Job:new {
    command = command,
    args = args,
  }

  job:after(vim.schedule_wrap(function(self, code)
    if code ~= 0 then
      -- a query that fails to compile is reported on stdout
      local err = table.concat(self:stderr_result(), "\n")
      cb(nil, vim.trim(err ~= "" and err or table.concat(self:result(), "\n")))
    else
      cb(self:result(), nil)
    end
  end))

  local ok, err = pcall(job.start, job)
  if not ok then
    vim.schedule(function()
      cb(nil, ("could not run %s: %s"):format(command, err))
    end)
  end
end

---@class TatrContext
---@field config { taskDir: string, order: string[], markers: table<string, string[]>, autoTags: table<string, string[]> }
---@field root string absolute path of the task dir

--- `tatr config`: the config of the enclosing repo, defaults filled in.
---@param opts { cmd: string[] }
---@param cb fun(ctx: TatrContext?, err: string?)
function M.config(opts, cb)
  run({ cmd = opts.cmd, args = { "config" } }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    local ok, ctx = pcall(vim.json.decode, table.concat(lines, "\n"))
    if not ok then
      return cb(nil, "could not read tatr config: " .. ctx)
    end

    cb(ctx, nil)
  end)
end

--- The task dir of the enclosing repo, absolute, off `tatr config`.
---@param opts { cmd: string[] }
---@param cb fun(dir: string?, err: string?)
function M.root(opts, cb)
  M.config(opts, function(ctx, err)
    if not ctx then
      return cb(nil, err)
    end

    cb(vim.fs.normalize(ctx.root), nil)
  end)
end

--- `tatr mint`: an id for a task that does not exist yet.
---@param opts { cmd: string[] }
---@param cb fun(id: string?, err: string?)
function M.mint(opts, cb)
  run({ cmd = opts.cmd, args = { "mint" } }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    cb(vim.trim(lines[1]), nil)
  end)
end

--- `tatr new <title> -f filename`: create a task, answer with its path.
--- `files` are what the task came out of, which the repo's `autoTags` may add
--- tags of its own for.
---@param opts { cmd: string[], title: string[], id?: string, tags?: string[], files?: string[] }
---@param cb fun(file: string?, err: string?)
function M.new(opts, cb)
  local args = { "new", "-f", "filename" }
  if opts.id then
    vim.list_extend(args, { "--id", opts.id })
  end
  for _, tag in ipairs(opts.tags or {}) do
    vim.list_extend(args, { "-t", tag })
  end
  for _, file in ipairs(opts.files or {}) do
    vim.list_extend(args, { "--file", file })
  end
  vim.list_extend(args, opts.title)

  run({ cmd = opts.cmd, args = args }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    cb(vim.fs.normalize(vim.trim(lines[1])), nil)
  end)
end

--- `tatr show <id>`: the task's body, front matter stripped.
---@param opts { cmd: string[], id: string }
---@param cb fun(lines: string[]?, err: string?)
function M.show(opts, cb)
  run({ cmd = opts.cmd, args = { "show", opts.id } }, cb)
end

--- `tatr show <id> -f filepath`: where the task with this id lives.
---@param opts { cmd: string[], id: string }
---@param cb fun(file: string?, err: string?)
function M.path(opts, cb)
  run({ cmd = opts.cmd, args = { "show", opts.id, "-f", "filepath" } }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    cb(vim.fs.normalize(vim.trim(lines[1])), nil)
  end)
end

--- `tatr close <id>`: mark the task closed, answer with what the cli said.
--- The only synchronous call here: fzf reloads its list the moment the action
--- returns, so the write has to have landed by then.
---@param opts { cmd: string[], id: string }
---@return string? line, string? err
function M.close(opts)
  local args = vim.deepcopy(opts.cmd)
  local command = table.remove(args, 1)
  vim.list_extend(args, { "close", opts.id })

  local job = Job:new {
    command = command,
    args = args,
  }

  local ok, out = pcall(job.sync, job)
  if not ok then
    return nil, ("could not run %s: %s"):format(command, out)
  end

  if job.code ~= 0 then
    -- a missing id is reported on stdout, the way the other calls have it
    local err = vim.trim(table.concat(job:stderr_result(), "\n"))
    return nil, err ~= "" and err or vim.trim(table.concat(out, "\n"))
  end

  return vim.trim(table.concat(out, "\n")), nil
end

--- `tatr ls -f json`, decoded.
---@param opts { cmd: string[], args: string[] }
---@param cb fun(tasks: TatrTask[]?, err: string?)
function M.list(opts, cb)
  local args = { "ls", "--log-level=none", "-f", "json" }
  vim.list_extend(args, opts.args)

  run({ cmd = opts.cmd, args = args }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    local ok, tasks = pcall(vim.json.decode, table.concat(lines, "\n"))
    if not ok then
      return cb(nil, "tatr ls did not print json")
    end

    cb(tasks, nil)
  end)
end

return M
