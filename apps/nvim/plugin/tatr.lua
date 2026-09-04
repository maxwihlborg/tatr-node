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
