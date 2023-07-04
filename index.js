const revolt = require("revolt.js");
const Discord = require("discord.js")
const emojiText = require("emoji-text")
const snek = require("snekfetch")
const {
    MongoClient
} = require('mongodb');
const dclient = new Discord.Client({
    intents: [Discord.GatewayIntentBits.DirectMessages, Discord.GatewayIntentBits.GuildMembers, Discord.GatewayIntentBits.GuildMessages, Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.MessageContent]
});
const client = new revolt.Client();
const prefix = "!!"
const url = 'mongodb://127.0.0.1:27017';
const database = new MongoClient(url);
const cfg = require("./config.json")
var awaiting = []
client.on("ready", async () => {
    console.log(`Logged in as ${client.user.username}!`)
})
dclient.on("ready", async () => {
    await database.connect()
    console.log(`Logged in as ${dclient.user.username}!`)
})

client.on("messageCreate", async (message) => {
    if (message.masquerade !== undefined) return;
    if (message.authorId === client.user.id) return;
    const db = database.db("RevoltBridge")
    const col = db.collection("servers")
    const msgcol = db.collection("messages")
    col.findOne({
        revolt: message.server.id
    }).then(async svr => {
        if (svr !== null) {
            let connectedGuild = await dclient.guilds.fetch({
                guild: svr.id
            });
            let matchedChannel = (await connectedGuild.channels.fetch()).find(i => (i.name === message.channel.name || i.name.replace(/-/g, " ") === message.channel.name));
            if (matchedChannel) {
                const atts = message.attachments?.map((attachment) => {
                    return {
                        file: `https://autumn.revolt.chat/attachments/${attachment.id}/${encodeURIComponent(attachment.filename)}`,
                        alt: attachment.filename,
                        spoiler: false,
                        name: attachment.filename,
                    };
                }) || []
                var msgatts = []
                for (let att of atts) {
                    msgatts.push({
                        attachment: att.file,
                        name: att.name
                    })
                }
                var repls = []
                if (message.replyIds) {
                    for (let repl of message.replyIds) {
                        const reply = await message.channel.fetchMessage(repl)
                        var embd
                        if (!reply.masquerade) {
                            embd = new Discord.EmbedBuilder()
                                .setAuthor({
                                    name: `reply to ${reply.author ? reply.author.username : "UNDEFINED"}`,
                                    iconURL: reply.author ? reply.author.avatarURL : undefined
                                })
                                .setDescription(reply.content)
                        } else {
                            embd = new Discord.EmbedBuilder()
                                .setAuthor({
                                    name: `reply to ${reply.masquerade.name}`,
                                    iconURL: reply.masquerade.avatar ? reply.masquerade.avatar : undefined
                                })
                                .setDescription(reply.content)
                        }
                        repls.push(embd)
                    }
                }
                try {
                    const webhook = (await connectedGuild.fetchWebhooks()).find(i => i.name === "RevoltBridgeHook")
                    if (webhook) {
                        if (webhook.channelId !== matchedChannel.id) {
                            await webhook.edit({
                                channel: matchedChannel.id
                            })
                        }
                        webhook.send({
                            content: message.content,
                            username: message.username,
                            avatarURL: message.avatarURL,
                            files: msgatts,
                            allowedMentions: {
                                parse: []
                            },
                            embeds: repls
                        }).then(msg => {
                            msgcol.insertOne({
                                dch: msg.channelId,
                                did: msg.id,
                                rid: message.id,
                                sid: msg.guildId,
                                rch: message.channelId
                            })
                        })
                    }
                } catch {
                    matchedChannel.send({
                        content: `${message.username}: ${message.content}`,
                        files: msgatts,
                        embeds: repls
                    }).then(msg => {
                        msgcol.insertOne({
                            dch: msg.channelId,
                            did: msg.id,
                            rid: message.id,
                            sid: msg.guildId,
                            rch: message.channelId
                        })
                    })
                }
            }
        }
    })
    if (!message.content.startsWith(prefix)) return
    const args = message.content.split(" ").slice(1)
    const command = message.content.split(" ")[0].replace(prefix, "")
    switch (command) {
        case "masquerade":
            message.reply({
                masquerade: {
                    name: dclient.user.username,
                    avatar: dclient.user.avatarURL()
                },
                content: "hello, world!"
            })
            break;
        case "connect":
            if (message.author.id !== message.server.owner.id) return message.reply("you need to be the owner in order to connect 2 servers.")
            if (!args[0]) return message.reply("you need to specify the discord server ID.")
            try {
                const guild = await dclient.guilds.fetch(args[0])
                const channels = await guild.channels.fetch()
                channels.find(i => i.type === Discord.ChannelType.GuildText).send(`<@${guild.ownerId}>, confirm you want to connect with: ${message.server.name} (${prefix}connect ${message.server.id}).`)
                awaiting.push(message.server.id)
                message.reply("Check discord.")
            } catch (err) {
                message.reply(err.toString())
            }
            break;
        default:
            message.reply("Unknown command.")
            break;
    }
});

dclient.on("messageCreate", async (message) => {
    if (message.author.id === dclient.user.id) return
    if (message.webhookId) {
        const detwebhook = (await message.guild.fetchWebhooks()).find(i => i.id === message.webhookId)
        if (detwebhook && detwebhook.name === "RevoltBridgeHook") {
            return
        }
    }
    const db = database.db("RevoltBridge")
    const col = db.collection("servers")
    const msgcol = db.collection("messages")
    col.findOne({
        id: message.guildId
    }).then(async svr => {
        if (svr !== null) {
            let connectedGuild = await client.servers.fetch(svr.revolt);
            let matchedChannel = connectedGuild.channels.find(i => (i.name === message.channel.name || i.name === message.channel.name.replace(/-/g, " ")));
            if (matchedChannel) {
                var parsedContent = emojiText.convert(message.content, {
                    delimiter: ':'
                })
                var content = parsedContent === "" ? "*empty*" : parsedContent
                var attachments = []
                var embds = []
                for (const [_, val] of message.attachments.entries()) {
                    try {
                        var formdat = new FormData()
                        formdat.append("file", await fetch(val.proxyURL).then((res) =>
                            res.blob()
                        ))
                        attachments.push(
                            (
                                await (
                                    await fetch(`https://autumn.revolt.chat/attachments`, {
                                        method: "POST",
                                        body: formdat,
                                    })
                                ).json()
                            ).id
                        )
                    } catch (err) {
                        console.log(err)
                        content += "\nattachment: " + val.proxyURL
                    }
                }
                if (message.reference) {
                    const ref = await message.fetchReference()
                    embds.push({
                        title: `reply to ${ref.author.tag}`,
                        description: ref.content.length < 1 ? "*empty*" : ref.content
                    })
                }
                if (message.embeds) {
                    for (let embd of message.embeds) {
                        let att = ""
                        if (embd.image) {
                            var formdat = new FormData()
                            formdat.append("file", await fetch(embd.image.proxyURL).then((res) =>
                                res.blob()
                            ))
                            att = (
                                await (
                                    await fetch(`https://autumn.revolt.chat/attachments`, {
                                        method: "POST",
                                        body: formdat,
                                    })
                                ).json()
                            ).id
                        }
                        embds.push({
                            icon_url: embd.thumbnail ? embd.thumbnail.url : null,
                            url: embd.url,
                            title: embd.title,
                            description: embd.description,
                            media: att ? att : null,
                            colour: embd.hexColor
                        })
                    }
                }
                matchedChannel.sendMessage({
                    masquerade: {
                        name: message.author.username,
                        avatar: message.author.avatarURL()
                    },
                    content: content,
                    attachments: attachments.length ? attachments : null,
                    embeds: embds.length ? embds : null
                }).then(msg => {
                    msgcol.insertOne({
                        rch: msg.channelId,
                        rid: msg.id,
                        did: message.id,
                        sid: message.guildId,
                        dch: message.channelId
                    })
                })
            }
        }
    })
    if (!message.content.startsWith(prefix)) return
    const args = message.content.split(" ").slice(1)
    const command = message.content.split(" ")[0].replace(prefix, "")
    switch (command) {
        case "webhook":
            try {
                (await (await message.guild.fetchWebhooks()).find(i => i.name === "RevoltBridgeHook").edit({
                    channel: message.channel.id
                })).send({
                    content: "Hello, World!",
                    username: client.user.username,
                    avatarURL: client.user.avatarURL
                })
            } catch (err) {
                message.reply("Whoops! " + err.toString())
            }
            break;
		case "update":
		    await message.react("🔃")
			await message.react("✅")
			process.exit()
		    break
        case "disconnect":
            if (message.author.id !== message.guild.ownerId) return message.reply("you need to be the owner in order to disconnect 2 servers.")
            message.reply("Wiping messages from db...")
            await msgcol.deleteMany({
                sid: message.guildId
            })
            message.reply("Wiping server from db...")
            await col.deleteOne({
                id: message.guildId
            })
            message.reply("Done! Feel free to kick the bot. Remember to delete the webhook!")
            try {
                (await (await message.guild.fetchWebhooks()).find(i => i.name === "RevoltBridgeHook").edit({
                    channel: message.channel.id
                })).send({
                    content: "Hello, feel free to delete me!",
                    username: "Webhook Test"
                })
            } catch {}
            break;
		case "exit":
		    message.reply("rest in pepperoni").then(() => {
				message.reply("failed to kill parent process")
			})
		    break;
        case "connect":
            if (message.author.id !== message.guild.ownerId) return message.reply("you need to be the owner in order to connect 2 servers.")
            if (!args[0]) return message.reply("you need to specify the revolt server ID.")
            try {
                const server = await client.servers.fetch(args[0])
                const channels = await message.guild.channels.fetch()
                if (awaiting.includes(args[0])) {
                    const arrindex = awaiting.indexOf(args[0])
                    if (arrindex > -1) {
                        awaiting.splice(arrindex, 1)
                    }
                    message.reply("Re-creating channels...")
                    var index = 0
                    channels.forEach(dch => {
                        setTimeout(() => {
                            if (dch.type !== Discord.ChannelType.GuildCategory) {
                                server.createChannel({
                                        name: dch.name,
                                        type: (dch.type === Discord.ChannelType.GuildVoice || dch.type === Discord.ChannelType.GuildStageVoice) ? "Voice" : "Text",
                                        description: dch.topic,
                                        nsfw: dch.nsfw
                                    })
                                    .catch(err => {
                                        message.reply(err.toString())
                                    })
                            }
                        }, 5000 * index);
                        index++
                    })
                    setTimeout(async () => {
                        message.reply("Done re-creating channels. Please categorize them yourself.")
                        message.reply("Adding you to the database...")
                        const db = database.db("RevoltBridge")
                        const col = db.collection("servers")
                        await col.insertOne({
                            id: message.guildId,
                            revolt: args[0]
                        })
                        message.reply("Done! Creating webhook...")
                        message.channel.createWebhook({
                                name: "RevoltBridgeHook",
                                avatar: "https://i.imgur.com/AfFp7pu.png"
                            })
                            .then(() => {
                                message.reply("All done. Restarting bot (cache reset)...").then(() => {
                                    process.exit(1)
                                })
                            })
                            .catch(err => {
                                message.reply(`Error while webhook creation: ${err.toString()}`)
                            })
                    }, 5000 * channels.size);
                } else {
                    message.reply("Not awaiting.")
                }
            } catch {
                message.reply("Unknown error.")
            }
            break;
        default:
            message.reply("Unknown command.")
            break;
    }
});

dclient.on("messageDelete", async (delmsg) => {
    const db = database.db("RevoltBridge")
    const msgcol = db.collection("messages")
    const delmsgdb = await msgcol.findOne({
        did: delmsg.id
    })
    if (delmsgdb) {
        try {
            (await client.messages.fetch(delmsgdb.rch, delmsgdb.rid)).delete()
        } catch (err) {
            console.log(err)
        }
        msgcol.deleteOne(delmsgdb)
    }
})

client.on("messageDelete", async (delmsg) => {
    const db = database.db("RevoltBridge")
    const msgcol = db.collection("messages")
    const delmsgdb = await msgcol.findOne({
        rid: delmsg.id
    })
    if (delmsgdb) {
        try {
            (await (await dclient.channels.fetch(delmsgdb.dch)).messages.fetch(delmsgdb.did)).delete()
        } catch (err) {
            console.log(err)
        }
        msgcol.deleteOne(delmsgdb)
    }
})

client.loginBot(cfg.revoltToken);
dclient.login(cfg.discordToken)