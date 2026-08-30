# Initial Ideas

- Data source is GEDCOM, should be able to import and export, the idea is to keep data in sync between the site and a gedcom file that I edit with MacFamilyTree
- Edit screen with all the options that MacFamilyTree has (see screenshot)
- Website has both view mode for most people and edit mode for moderators
- Website has auth using either email/password or gmail auth
- Initial login prompts user for name and birth month/year to find them in the tree, they are assigned to that node, their ability to see data is tied to this (I haven't worked out how I want this to work yet exactly)
- Frontend should be react, probably reactflow for main UI for now
- We will render the person who is logged in, their parents, their siblings, their children, and grand children.
- Navigation up or down the tree involves clicking on individuals and then they become the focused person and you see their parents, siblings, children, grandchildren
- Image/document processing will require a backend, probalby C# with idesign, depending on hosting options
- We allow any file format for upload within reason, images, pdfs, etc. Cap at something reasonable, 5 or 10mb?
- Database should be supabase, supabase handles file uploads and auth if possible
- project should be reusable, I want to make it open source so others can host their own family trees
- Will need a global admin to set up moderators, and users, probably some kind of settings page
- Invite system, hopefully some kind of free email sign up or magic links maybe?
- Ideas for hosting: vercel for free tier, same with supabase, github for repo and actions there. We don't have to set up the deploy or hosting yet, that's just to get you thinking about it, I want to be able to run this all on my mac