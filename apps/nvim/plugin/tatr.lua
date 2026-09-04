if vim.g.loaded_tatr then
  return
end
vim.g.loaded_tatr = true

vim.api.nvim_create_user_command("Tatr", function(cmd)
  require("tatr").pick { query = cmd.fargs }
end, {
  nargs = "*",
  desc = "Pick a tatr task, filtered by an optional query",
})

vim.api.nvim_create_user_command("TatrNew", function(cmd)
  local tatr = require "tatr"

  if #cmd.fargs > 0 then
    return tatr.new { title = cmd.fargs }
  end

  vim.ui.input({ prompt = "Task title: " }, function(title)
    if title and vim.trim(title) ~= "" then
      tatr.new { title = { title } }
    end
  end)
end, {
  nargs = "*",
  desc = "Create a tatr task and open it, asking for a title if given none",
})
