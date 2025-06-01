const Fuse = require("fuse.js")

const searchFuse = (array, displayFields, searchStr) => {
    const options = {
        keys: displayFields.flatMap((elem) => elem[0]),
        threshold: 0.4, // Чем ниже, тем точнее поиск
    };
    const fuse = new Fuse(array, options)
    const result = fuse.search(searchStr)
    return result

}

module.exports = searchFuse