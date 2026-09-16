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

vim.api.nvim_create_user_command("TatrMint", function()
  require("tatr").mint()
end, {
  desc = "Insert a freshly minted '[id]: ' at the cursor",
})

vim.api.nvim_create_user_command("TatrTodo", function()
  require("tatr").todo()
end, {
  desc = "Turn the TODO/FIXME on this line into a task, marker replaced by its id",
})

vim.api.nvim_create_user_command("TatrUpsert", function()
  require("tatr").upsert()
end, {
  desc = "Open the task the '[id]' on this line refers to, creating it if needed",
})
