/**
 * NodeJs Server-Side Example for Fine Uploader (traditional endpoints).
 * Maintained by Widen Enterprises.
 *
 * This example:
 *  - handles non-CORS environments
 *  - handles delete file requests assuming the method is DELETE
 *  - Ensures the file size does not exceed the max
 *  - Handles chunked upload requests
 *
 * Requirements:
 *  - express (for handling requests)
 *  - rimraf (for "rm -rf" support)
 *  - multiparty (for parsing request payloads)
 *  - mkdirp (for "mkdir -p" support)
 */

// Dependencies
var express = require("express"),
    fs = require("fs"),
    util = require('util'),
    rimraf = util.promisify(require("rimraf")),
    mkdirp = util.promisify(require("mkdirp")),
    multiparty = require('multiparty'),
    path = require('path'),
    app = express(),

    // paths/constants
    fileInputName = process.env.FILE_INPUT_NAME || "qqfile",
    publicDir = path.join(process.cwd(), '_build'),
    // nodeModulesDir = process.env.NODE_MODULES_DIR,
    uploadedFilesPath = path.join(__dirname, 'tmp/',),
    chunkDirName = "chunks",
    port = process.env.SERVER_PORT || 8000,
    maxFileSize = process.env.MAX_FILE_SIZE || 0; // in bytes, 0 for unlimited


app.listen(port, () => console.log('running at port', port));

// routes
app.use(express.static(publicDir));
app.get('/', (req, res)=>{
    res.sendFile(path.join(__dirname, 'index.html'))
})
// app.use("/node_modules", express.static(nodeModulesDir));
app.post("/uploads", onUpload);
app.delete("/uploads/:uuid", onDeleteFile);


async function onUpload(req, res) {
    var form = new multiparty.Form();
    // const parse = util.promisify(form.parse)

    const {fields, files} = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
            if(err)
                reject(err)
            resolve({ fields, files })
        })
    })
    // var partIndex = fields.qqpartindex;
    const file = files[fileInputName][0]

    // text/plain is required to ensure support for IE9 and older
    res.set("Content-Type", "text/plain");
    // if (partIndex == null) {
    //     onSimpleUpload(fields, files[fileInputName][0], res);
    // }
    // else {
    //     onChunkedUpload(fields, files[fileInputName][0], res);
    // }
    var size = parseInt(fields.qqtotalfilesize),
        uuid = fields.qquuid,
        index = fields.qqpartindex,
        totalParts = parseInt(fields.qqtotalparts),
        responseData = {
            success: false
        };

    file.name = fields.qqfilename;
    if(isValid(size)){
        try {
            await storeChunk(file, uuid, index, totalParts)
            if (index >= totalParts - 1) {
                await combineChunks(file, uuid)
            }
            responseData.success = true;
            return res.send(responseData);
        } catch (error) {
            return res.send(400, { error })
        }
    }
    responseData.error = "Too big!";
    responseData.preventRetry = true;
    return res.send(responseData);
}

// function onSimpleUpload(fields, file, res) {
//     var uuid = fields.qquuid,
//         responseData = {
//             success: false
//         };

//     file.name = fields.qqfilename;

//     if (isValid(file.size)) {
//         moveUploadedFile(file, uuid, function() {
//                 responseData.success = true;
//                 res.send(responseData);
//             },
//             function() {
//                 responseData.error = "Problem copying the file!";
//                 res.send(responseData);
//             });
//     }
//     else {
//         failWithTooBigFile(responseData, res);
//     }
// }

// function failWithTooBigFile(responseData, res) {
//     responseData.error = "Too big!";
//     responseData.preventRetry = true;
//     res.send(responseData);
// }

function onDeleteFile(req, res) {
    var uuid = req.params.uuid,
        dirToDelete = uploadedFilesPath + uuid;

    rimraf(dirToDelete, function(error) {
        if (error) {
            console.error("Problem deleting file! " + error);
            res.status(500);
        }

        res.send();
    });
}

function isValid(size) {
    return maxFileSize === 0 || size < maxFileSize;
}

async function moveFile(destinationDir, sourceFile, destinationFile) {
    await mkdirp(destinationDir)
    return new Promise((resolve, reject) => {
        var sourceStream, destStream;
        sourceStream = fs.createReadStream(sourceFile);
        destStream = fs.createWriteStream(destinationFile);
        sourceStream
            .on("error", function(error) {
                console.error("Problem copying file: " + error.stack);
                destStream.end();
                reject()
            })
            .on("end", function(){
                destStream.end();
                resolve()
            })
            .pipe(destStream);
    })
}

// function moveUploadedFile(file, uuid, success, failure) {
//     var destinationDir = uploadedFilesPath + uuid + "/",
//         fileDestination = destinationDir + file.name;

//     return moveFile(destinationDir, file.path, fileDestination);
// }

function storeChunk(file, uuid, index, numChunks) {
    var destinationDir = uploadedFilesPath + uuid + "/" + chunkDirName + "/",
        chunkFilename = getChunkFilename(index, numChunks),
        fileDestination = destinationDir + chunkFilename;

    return moveFile(destinationDir, file.path, fileDestination);
}

async function combineChunks(file, uuid) {
    var chunksDir = uploadedFilesPath + uuid + "/" + chunkDirName + "/",
        destinationDir = uploadedFilesPath + uuid + "/",
        fileDestination = destinationDir + file.name;

    const readDir = util.promisify(fs.readdir)
    const fileNames = await readDir(chunksDir)
    fileNames.sort()
    destFileStream = fs.createWriteStream(fileDestination, {flags: "a"});
    await new Promise((resolve, reject) => {
        function appendToStream(destStream, srcDir, srcFilesnames, index) {
            if (index < srcFilesnames.length) {
                fs.createReadStream(srcDir + srcFilesnames[index])
                    .on("end", () => {
                        appendToStream(destStream, srcDir, srcFilesnames, index + 1);
                    })
                    .on("error", (error) =>{
                        destStream.end();
                        reject("Problem appending chunk! " + error)
                    })
                    .pipe(destStream, {end: false});
            }
            else {
                destStream.end();
                resolve();
            }
        }
        appendToStream(destFileStream, chunksDir, fileNames, 0)
    })
    await rimraf(chunksDir)
}

function getChunkFilename(index, count) {
    var digits = new String(count).length,
        zeros = new Array(digits + 1).join("0");

    return (zeros + index).slice(-digits);
}
