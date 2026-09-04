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

--- `tatr root`: the task dir of the enclosing repo.
---@param opts { cmd: string[] }
---@param cb fun(dir: string?, err: string?)
function M.root(opts, cb)
  run({ cmd = opts.cmd, args = { "root" } }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    cb(vim.fs.normalize(vim.trim(lines[1])), nil)
  end)
end

--- `--order` for `tatr ls`, nothing when the caller has no preference and the
--- cli's own default should stand.
---@param order string[]
---@return string[]
function M.order(order)
  return #order > 0 and { "--order=" .. table.concat(order, ", ") } or {}
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
---@param opts { cmd: string[], title: string[], id?: string, tags?: string[] }
---@param cb fun(file: string?, err: string?)
function M.new(opts, cb)
  local args = { "new", "-f", "filename" }
  if opts.id then
    vim.list_extend(args, { "--id", opts.id })
  end
  for _, tag in ipairs(opts.tags or {}) do
    vim.list_extend(args, { "-t", tag })
  end
  vim.list_extend(args, opts.title)

  run({ cmd = opts.cmd, args = args }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    cb(vim.fs.normalize(vim.trim(lines[1])), nil)
  end)
end

--- `tatr preview <id>`: the task's body, front matter stripped.
---@param opts { cmd: string[], id: string }
---@param cb fun(lines: string[]?, err: string?)
function M.preview(opts, cb)
  run({ cmd = opts.cmd, args = { "preview", opts.id } }, cb)
end

--- `tatr preview <id> --resolve-path`: where the task with this id lives.
---@param opts { cmd: string[], id: string }
---@param cb fun(file: string?, err: string?)
function M.path(opts, cb)
  run({ cmd = opts.cmd, args = { "preview", opts.id, "--resolve-path" } }, function(lines, err)
    if not lines then
      return cb(nil, err)
    end

    cb(vim.fs.normalize(vim.trim(lines[1])), nil)
  end)
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
